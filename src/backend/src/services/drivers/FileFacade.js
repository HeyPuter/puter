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
const { AdvancedBase } = require("../../../../putility");
const { Context } = require("../../util/context");
const { MultiValue } = require("../../util/multivalue");
const { stream_to_buffer } = require("../../util/streamutil");
const { PassThrough } = require("stream");
const { LLRead } = require("../../filesystem/ll_operations/ll_read");
const APIError = require("../../api/APIError");

/**
* @class FileFacade
* This class is used to provide a unified interface for
* passing files through the Puter Driver API, and avoiding
* unnecessary work such as downloading the file from S3
* (when a Puter file is specified) in case the underlying
* implementation can accept S3 bucket information instead
* of the file's contents.
* @extends AdvancedBase
* @description This class provides a unified interface for passing files through the Puter Driver API. It aims to avoid unnecessary operations such as downloading files from S3 when a Puter file is specified, especially if the underlying implementation can accept S3 bucket information instead of the file's contents.
*/
class FileFacade extends AdvancedBase {
    static OUT_TYPES = {
        S3_INFO: { key: 's3-info' },
        STREAM: { key: 'stream' },
    }

    static MODULES = {
        axios: require('axios'),
    }

    constructor (...a) {
        super(...a);

        this.values = new MultiValue();

        this.values.add_factory('fs-node', 'uid', async uid => {
            const context = Context.get();
            const services = context.get('services');
            const svc_filesystem = services.get('filesystem');
            const fsNode = await svc_filesystem.node({ uid });
            return fsNode;
        });

        this.values.add_factory('fs-node', 'path', async path => {
            const context = Context.get();
            const services = context.get('services');
            const svc_filesystem = services.get('filesystem');
            const fsNode = await svc_filesystem.node({ path });
            return fsNode;
        });

        this.values.add_factory('s3-info', 'fs-node', async fsNode => {
            try {
                return await fsNode.get('s3:location');
            } catch (e) {
                return null;
            }
        });

        this.values.add_factory('stream', 'fs-node', async fsNode => {
            if ( ! await fsNode.exists() ) return null;

            const context = Context.get();

            const ll_read = new LLRead();
            const stream = await ll_read.run({
                actor: context.get('actor'),
                fsNode,
            });

            return stream;
        });

        this.values.add_factory('stream', 'web_url', async web_url => {
            const response = await(async () => {
                try {
                    return await FileFacade.MODULES.axios.get(web_url, {
                        responseType: 'stream',
                    });
                } catch (e) {
                    throw APIError.create('field_invalid', null, {
                        key: 'url',
                        expected: 'web URL',
                        got: 'error during request: ' + e.message,
                    });
                }
            })();

            return response.data;
        });

        this.values.add_factory('stream', 'data_url', async data_url => {
            const data = data_url.split(',')[1];
            const buffer = Buffer.from(data, 'base64');
            const stream = new PassThrough();
            stream.end(buffer);
            return stream;
        });

        this.values.add_factory('buffer', 'stream', async stream => {
            return await stream_to_buffer(stream);
        });
    }

    set (k, v) { this.values.set(k, v); }
    get (k) { return this.values.get(k); }


}

module.exports = {
    FileFacade,
};
