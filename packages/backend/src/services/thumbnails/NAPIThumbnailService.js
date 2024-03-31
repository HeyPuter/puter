/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
