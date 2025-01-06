// METADATA // {"ai-commented":{"service":"claude"}}
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
const BaseService = require('../BaseService');


/**
* Service class for generating thumbnails using Node API (NAPI)
* Extends BaseService to handle thumbnail generation for various image formats
* Supports multiple image types (JPEG, PNG, WebP, GIF, AVIF, TIFF, SVG)
* Implements size limits and format validation for thumbnail generation
* Uses Sharp library for image processing and transformation
* @class NAPIThumbnailService
* @extends BaseService
*/
class NAPIThumbnailService extends BaseService {
    static LIMIT = 400 * 1024 * 1024;
    static SUPPORTED_MIMETYPES = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "image/avif",
        "image/tiff",
        "image/svg+xml"
    ];

    static MODULES = {
        sharp: () => require('sharp'),
    };

    is_supported_mimetype (mimetype) {
        return this.constructor.SUPPORTED_MIMETYPES.includes(mimetype);
    }

    /**
    * Checks if a file size is within the supported limit for thumbnail generation
    * @param {number} size - The file size in bytes to check
    * @returns {boolean} True if size is less than or equal to the limit, false otherwise
    */
    is_supported_size (size) {
        return size <= this.constructor.LIMIT;
    }
    async thumbify (file) {
        const transformer = await this.modules.sharp()()
            .resize(128)
            .png();
        file.stream.pipe(transformer);
        const buffer = await transformer.toBuffer();
            // .toBuffer();
        const base64 = buffer.toString('base64');
        return `data:image/png;base64,${base64}`;
    }
}

module.exports = {
    NAPIThumbnailService,
};
