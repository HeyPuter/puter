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
const Jimp = require('jimp');
const BaseService = require('../BaseService');
const { stream_to_buffer } = require('../../util/streamutil');

class PureJSThumbnailService extends BaseService {
    static DESCRIPTION = `
        This thumbnail service doesn't depend on any low-level compiled
        libraries. It is CPU-intensive, so it's not ideal for production
        deployments, but it's great for development and testing.
    `;

    static LIMIT = 400 * 1024 * 1024;
    static SUPPORTED_MIMETYPES = [
        "image/jpeg",
        "image/png",
        "image/bmp",
        "image/tiff",
        "image/gif"
    ]

    static MODULES = {
        jimp: require('jimp'),
    };

    is_supported_mimetype (mimetype) {
        return this.constructor.SUPPORTED_MIMETYPES.includes(mimetype);
    }
    is_supported_size (size) {
        return size <= this.constructor.LIMIT;
    }

    async thumbify (file) {
        const buffer = await stream_to_buffer(file.stream);
        const image = await Jimp.read(buffer);
        image.resize(128, 128);
        const base64 = await image.getBase64Async(Jimp.MIME_PNG);
        return base64;
    }
}

module.exports = {
    PureJSThumbnailService,
};
