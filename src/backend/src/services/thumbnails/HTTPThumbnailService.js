// METADATA // {"ai-commented":{"service":"xai"}}
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
// TODO: If an RPC protocol is ever used this service can be replaced
//       with a more general RPCService and a model.

const axios = require('axios');

const { TeePromise } = require('@heyputer/putility').libs.promise;
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


    /**
    * Recycles the ThumbnailOperation instance.
    * 
    * Increments the recycle count and checks if the operation can be recycled again.
    * If the recycle count exceeds the maximum allowed, the operation is resolved with undefined.
    * 
    * @returns {boolean} Returns true if the operation can be recycled, false otherwise.
    */
    recycle () {
        this.recycle_count++;

        if ( this.recycle_count > this.constructor.MAX_RECYCLE_COUNT ) {
            this.resolve(undefined);
            return false;
        }

        return true;
    }
}


/**
* @class HTTPThumbnailService
* @extends BaseService
* @description
* This class implements a service for generating thumbnails from various file types via HTTP requests.
* It manages a queue of thumbnail generation operations, handles the execution of these operations,
* and provides methods to check file support, manage service status, and interact with an external
* thumbnail generation service. The service can be configured to periodically query supported MIME types
* and handles file size limitations and recycling of thumbnail generation attempts.
*/
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
            /**
            * Periodically queries the thumbnail service for supported MIME types.
            * 
            * @memberof HTTPThumbnailService
            * @private
            * @method query_supported_mime_types_
            * @returns {Promise<void>} A promise that resolves when the query is complete.
            * @notes 
            *   - This method is called every minute if `query_supported_types` in the config is not set to false.
            *   - Updates the `SUPPORTED_MIMETYPES` static property of the class with the latest MIME types.
            */
            setInterval(() => {
                this.query_supported_mime_types_();
            }, 60 * 1000);
        }
    }


    /**
    * Sets up the HTTP routes for the thumbnail service.
    * This method is called during the installation process of the service.
    * 
    * @param {Object} _ - Unused parameter, typically the context or request object.
    * @param {Object} options - An object containing the Express application instance.
    * @param {Object} options.app - The Express application object to mount the routes onto.
    */
    async ['__on_install.routes'] (_, { app }) {
        /**
        * Sets up the routes for the thumbnail service.
        * 
        * This method is called when the service is installed to configure the Express application
        * with the necessary routes for handling thumbnail-related HTTP requests.
        * 
        * @param {Object} _ - Unused parameter, part of the installation context.
        * @param {Object} context - The context object containing the Express application.
        * @param {Express.Application} context.app - The Express application to configure routes on.
        */
        const r_thumbs = (() => {
            const require = this.require;
            const express = require('express');
            return express.Router();
        })();

        app.use('/thumbs', r_thumbs);

        r_thumbs.get('/status', (req, res) => {
            /**
            * Get the current status of the thumbnail service.
            * @param {Request} req - Express request object.
            * @param {Response} res - Express response object.
            */
            const status_as_string = (status) => {
                switch ( status ) {
                    case this.constructor.STATUS_IDLE:
                        return 'idle';
                    case this.constructor.STATUS_RUNNING:
                        return 'running';
                    default:
                        return 'unknown';
                }
            }
            res.json({
                status: status_as_string(this.status),
                queue: this.queue.length,
                recycle_counts: this.queue.map(job => job.recycle_count),
            });
        });
    }


    /**
    * Initializes the thumbnail service by setting up health checks.
    * This method is called when the service is installed to ensure
    * the thumbnail generation service is responsive.
    *
    * @async
    * @returns {Promise<void>} A promise that resolves when initialization is complete.
    */
    async _init () {
        const services = this.services;
        const svc_serverHealth = services.get('server-health');


        /**
        * Initializes the thumbnail service by setting up health checks.
        * @async
        * @method
        * @memberof HTTPThumbnailService
        * @instance
        * @description This method adds a health check for the thumbnail service to ensure it's operational.
        *              It uses axios to make a ping request to the thumbnail service.
        */
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
     * Thumbifies a given file by creating a thumbnail.
     *
     * @param {object} file - An object describing the file in the same format
     * as the file object created by multer. The necessary properties are
     * `buffer`, `filename`, and `mimetype`.
     * @returns {Promise<string|undefined>} A Promise that resolves to the base64 encoded thumbnail data URL,
     *                                       or `undefined` if thumbification fails or is not possible.
     * @throws Will log errors if thumbification process encounters issues.
     */
    async thumbify(file) {
        const job = new ThumbnailOperation(file);
        this.queue.push(job);
        this.checkShouldExec_();
        return await job;
    }


    /**
    * Checks if the thumbnail generation process should start executing.
    * This method evaluates if the service is in an idle state, has items in the queue,
    * and is not in test mode before initiating the execution.
    *
    * @private
    */
    checkShouldExec_ () {
        if ( this.test_mode ) {
            this.test_checked_exec = true;
            return;
        }
        if ( this.status !== this.constructor.STATUS_IDLE ) return;
        if ( this.queue.length === 0 ) return;
        this.exec_();
    }


    /**
    * Executes thumbnail generation for queued files.
    * 
    * This method is responsible for processing files in the queue for thumbnail generation.
    * It handles the transition of service status, manages file size limits, and initiates
    * the thumbnail generation process for files within the size limit. If errors occur,
    * it handles the resolution of jobs appropriately and logs errors.
    * 
    * @private
    */
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


    /**
    * Executes the thumbnail generation process for the given queue of jobs.
    * 
    * This method attempts to process the provided queue, handling errors gracefully
    * by recycling jobs or resolving them as undefined if they exceed size limits or
    * if an error occurs during the request. After execution, it updates the service
    * status and checks for further executions if needed.
    *
    * @param {Array<ThumbnailOperation>} queue - An array of ThumbnailOperation objects 
    * representing the jobs to be processed.
    * @returns {Promise<any>} - A promise that resolves with the results of the thumbnail 
    * generation or undefined if an error occurred.
    */
    async exec_0 (queue) {
        this.log.info('starting thumbnail request');
        const resp = await this.request_({ queue });
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


    /**
    * Handles the thumbnail request process by sending queued files to the thumbnail service,
    * managing the response, and resolving the thumbnail operations accordingly.
    * 
    * @param {ThumbnailOperation[]} queue - An array of ThumbnailOperation instances representing files to be thumbnailed.
    * @returns {Promise} A promise that resolves with the thumbnail service response or throws an error if the request fails.
    */
    async request_ ({ queue }) {
        if ( this.test_mode ) {
            const results = [];
            for ( const job of queue ) {
                console.log('file?', job.file);
                if ( job.file?.behavior === 'fail' ) {
                    throw new Error('test fail');
                }
                results.push({
                    encoded: 'data:image/png;base64,' +
                        'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX' +
                        '///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASU' +
                        'VORK5CYII',
                });
            }
            return {
                status: 200,
                data: results,
            };
        } 

        const form = new FormData();
        let expected = 0;
        for ( const job of queue ) {
            expected++;

            /**
            * Prepares and sends a request to the thumbnail service for processing multiple files.
            * 
            * @param {Object} options - Options object containing the queue of files.
            * @param {Array<ThumbnailOperation>} options.queue - An array of ThumbnailOperation objects to be processed.
            * @returns {Promise<Object>} A promise that resolves to the response from the thumbnail service.
            * @throws {Error} If the thumbnail service returns an error or if there's an issue with the request.
            */
            const file_data = job.file.buffer ? (() => {
                job.file.size = job.file.buffer.length;
                return buffer_to_stream(job.file.buffer);
            })() : job.file.stream;

            form.append('file', file_data, {
                filename: job.file.name ?? job.file.originalname,
                contentType: job.file.type ?? job.file.mimetype,
                knownLength: job.file.size,
            });
        }

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

        return resp;
    }


    /**
    * Queries the thumbnail services to check what mime types
    * are supported for thumbnail generation.
    * Updates internal state to reflect that.
    * @returns {Promise<void>} A promise that resolves when the MIME types are updated.
    */
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

    async _test ({ assert }) {
        /**
        * Runs unit tests for the HTTPThumbnailService.
        * 
        * @param {Object} options - An object containing test options.
        * @param {assert} options.assert - An assertion function for making test assertions.
        * 
        * @note This method sets up a testing environment by:
        *       - Disabling error reporting.
        *       - Muting logging operations.
        *       - Setting the service to test mode.
        *       - Testing the recycling behavior of ThumbnailOperation.
        *       - Executing thumbnailing jobs in various scenarios to ensure correct behavior.
        */
        this.errors.report = () => {};
        
        // Pseudo-logger to prevent errors from being thrown when this service
        // is running under the test kernel.
        this.log = {
            info: () => {},
            error: () => {},
            noticeme: () => {},
        };
        // Thumbnail operation eventually recycles
        {
            const thop = new ThumbnailOperation(null);
            for ( let i = 0 ; i < ThumbnailOperation.MAX_RECYCLE_COUNT ; i++ ) {
                /**
                * Tests the recycling behavior of ThumbnailOperation.
                * 
                * @param {Object} test - An object containing assertion methods.
                * @param {Function} test.assert - Assertion function to check conditions.
                */
                assert.equal(thop.recycle(), true, `recycle ${i}`);
            }
            assert.equal(thop.recycle(), false, 'recycle max');
        }

        this.test_mode = true;

        // Hunch: 

        // Request and await the thumbnailing of a few files
        for ( let i=0 ; i < 3 ; i++ ) {
            const job = new ThumbnailOperation({ behavior: 'ok' });
            this.queue.push(job);

        }
        this.test_checked_exec = false;
        await this.exec_();
        assert.equal(this.queue.length, 0, 'queue emptied');
        assert.equal(this.test_checked_exec, true, 'checked exec');


        // test with failed job
        const job = new ThumbnailOperation({ behavior: 'fail' });
        this.queue.push(job);
        this.test_checked_exec = false;
        await this.exec_();
        assert.equal(this.queue.length, 0, 'queue emptied');
        assert.equal(this.test_checked_exec, true, 'checked exec');

        this.test_mode = false;
    }
}

module.exports = {
    HTTPThumbnailService,
};
