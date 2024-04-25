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
// TODO: If an RPC protocol is ever used this service can be replaced
//       with a more general RPCService and a model.

const axios = require('axios');

const { TeePromise } = require("../../util/promise");
const { AdvancedBase } = require('@heyputer/puter-js-common');
const FormData = require("form-data");
const { stream_to_the_void, buffer_to_stream } = require('../../util/streamutil');
const BaseService = require('../BaseService');

class ThumbnailOperation extends TeePromise {
    // static MAX_RECYCLE_COUNT = 5*3;
    static MAX_RECYCLE_COUNT = 3;
    constructor (file) {
        super();
        this.file = file;
        this.recycle_count = 0;
    }

    recycle () {
        this.recycle_count++;

        if ( this.recycle_count > this.constructor.MAX_RECYCLE_COUNT ) {
            this.resolve(undefined);
            return false;
        }

        return true;
    }
}

class HTTPThumbnailService extends BaseService {
    static STATUS_IDLE = {};
    static STATUS_RUNNING = {};

    static LIMIT = 400 * 1024 * 1024;

    static MODULES = {
        setTimeout,
        axios,
    };

    static SUPPORTED_MIMETYPES = [
        'audio/ogg',
        'audio/wave',
        'audio/mpeg',
        'application/ogg',
        'application/pdf',
        // 'image/bmp',
        'image/gif',
        'image/jpeg',
        'image/jpg',
        'image/png',
        // 'image/tiff',
        'image/webp',
        'video/avi',
        'video/x-msvideo',
        'video/msvideo',
        'video/flv',
        'video/x-flv',
        'video/mp4',
        'video/x-matroska',
        'video/quicktime',
        'video/webm',
    ];

    constructor (cons) {
        const { services, my_config } = cons;
        super(cons);

        this.services = services;
        this.log = services.get('log-service').create('thumbnail-service');
        this.errors = services.get('error-service').create(this.log);
        this.config = my_config;

        this.queue = [];
        this.status = this.constructor.STATUS_IDLE;

        this.LIMIT = my_config?.limit ?? this.constructor.LIMIT;

        if ( my_config?.query_supported_types !== false ) {
            setInterval(() => {
                this.query_supported_mime_types_();
            }, 60 * 1000);
        }
    }

    async _init () {
        const services = this.services;
        const svc_serverHealth = services.get('server-health');

        svc_serverHealth.add_check('thumbnail-ping', async () => {
            this.log.noticeme('THUMBNAIL PING');
            await axios.request(
                {
                    method: 'get',
                    url: `${this.host_}/ping`,
                }
            );
        });
    }

    get host_ () {
        return this.config.host || 'http://127.0.0.1:3101';
    }

    is_supported_mimetype (mimetype) {
        return this.constructor.SUPPORTED_MIMETYPES.includes(mimetype);
    }

    is_supported_size (size) {
        return size < this.LIMIT;
    }

    /**
     *
     * @param {object} file - An object describing the file in the same format
     * as the file object created by multer. The necessary properties are
     * `buffer`, `filename`, and `mimetype`.
     */
    async thumbify(file) {
        const job = new ThumbnailOperation(file);
        this.queue.push(job);
        this.checkShouldExec_();
        return await job;
    }

    checkShouldExec_ () {
        if ( this.status !== this.constructor.STATUS_IDLE ) return;
        if ( this.queue.length === 0 ) return;
        this.exec_();
    }

    async exec_ () {
        const { setTimeout } = this.modules;

        this.status = this.constructor.STATUS_RUNNING;

        const LIMIT = this.LIMIT;

        // Grab up to 400MB worth of files to send to the thumbnail service.
        // Resolve any jobs as undefined if they're over the limit.

        let total_size = 0;
        const queue = [];
        while ( this.queue.length > 0 ) {
            const job = this.queue[0];
            const size = job.file.size;
            if ( size > LIMIT ) {
                job.resolve(undefined);
                if ( job.file.stream ) stream_to_the_void(job.file.stream);
                this.queue.shift();
                continue;
            }
            if ( total_size + size > LIMIT ) break;
            total_size += size;
            queue.push(job);
            this.queue.shift();
        }

        if ( queue.length === 0 ) {
            this.status = this.constructor.STATUS_IDLE;
            return;
        }

        try {
            return await this.exec_0(queue);
        } catch (err) {
            await new Promise(resolve => setTimeout(resolve, 200));

            // const new_queue = queue.filter(job => job.recycle());
            // this.queue = new_queue.concat(this.queue);
            this.queue = [];
            for ( const job of queue ) {
                if ( job.file.stream ) stream_to_the_void(job.file.stream);
                job.resolve(undefined);
            }

            this.errors.report('thumbnails-exec', {
                source: err,
                trace: true,
                alarm: true,
            });
        } finally {
            this.status = this.constructor.STATUS_IDLE;
            this.checkShouldExec_();
        }
    }

    async exec_0 (queue) {
        const { axios } = this.modules;

        let expected = 0;

        const form = new FormData();
        for ( const job of queue ) {
            expected++;
            // const blob = new Blob([job.file.buffer], { type: job.file.mimetype });
            // form.append('file', blob, job.file.filename);
            const file_data = job.file.buffer ? (() => {
                job.file.size = job.file.buffer.length;
                return buffer_to_stream(job.file.buffer);
            })() : job.file.stream;
            // const file_data = job.file.buffer ?? job.file.stream;
            console.log('INFORMATION ABOUT THIS FILE', {
                file_has_a_buffer: !!job.file.buffer,
                file_has_a_stream: !!job.file.stream,
                file: job.file,
            });
            form.append('file', file_data, {
                filename: job.file.name ?? job.file.originalname,
                contentType: job.file.type ?? job.file.mimetype,
                knownLength: job.file.size,
            });
        }

        this.log.info('starting thumbnail request');
        const resp = await axios.request(
            {
                method: 'post',
                url: `${this.host_}/thumbify`,
                data: form,
                headers: {
                    'Content-Type': 'multipart/form-data',
                }
            }
        );
        this.log.info('done thumbnail request');

        if ( resp.status !== 200 ) {
            this.log.error('Thumbnail service returned non-200 status');
            throw new Error('Thumbnail service returned non-200 status');
        }

        const results = resp.data;

        this.log.noticeme('response?', { resp });
        this.log.noticeme('data?', { data: resp.data });

        if ( results.length !== queue.length ) {
            this.log.error('Thumbnail service returned wrong number of results');
            throw new Error('Thumbnail service returned wrong number of results');
        }

        for ( let i = 0 ; i < queue.length ; i++ ) {
            const result = results[i];
            const job = queue[i];

            this.log.noticeme('result?', { result });
            job.resolve(
                result.encoded
                && `data:image/png;base64,${result.encoded}`
            );
        }
    }

    async query_supported_mime_types_() {
        const resp = await axios.request(
            {
                method: 'get',
                url: `${this.host_}/supported`,
            }
        );

        const data = resp.data;

        if ( ! Array.isArray(data) ) {
            this.log.error('Thumbnail service returned invalid data');
            return;
        }

        const mime_set = {};

        for ( const entry of data ) {
            mime_set[entry.StandardMIMEType] = true;
            for ( const mime of entry.MIMETypes ) {
                mime_set[mime] = true;
            }
        }

        this.constructor.SUPPORTED_MIMETYPES = Object.keys(mime_set);
    }
}

module.exports = {
    HTTPThumbnailService,
};
