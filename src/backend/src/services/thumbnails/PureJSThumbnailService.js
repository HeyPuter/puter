// METADATA // {"ai-commented":{"service":"mistral","model":"mistral-large-latest"}}
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
const Jimp = require('jimp');
const BaseService = require('../BaseService');
const { stream_to_buffer } = require('../../util/streamutil');


/**
* @class PureJSThumbnailService
* @extends BaseService
* @description This class represents a thumbnail service that operates entirely in JavaScript without relying on any low-level compiled libraries.
* It is designed for development and testing environments due to its CPU-intensive nature, making it less suitable for production deployments.
* The service supports various image formats and provides methods to check supported MIME types and file sizes, as well as to generate thumbnails.
*
* @deprecated as 'sharp' module is now required for app icons anyway
*/
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


    /**
    * Generates a thumbnail for the provided file.
    *
    * This method reads the file stream, resizes the image to 128x128 pixels,
    * and returns the resulting image as a base64 string.
    *
    * @param {Object} file - The file object containing the stream.
    * @param {Stream} file.stream - The stream of the file to be thumbnailed.
    * @returns {Promise<string>} A promise that resolves to the base64 string of the thumbnail.
    */
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
