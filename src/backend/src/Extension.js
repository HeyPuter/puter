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

const { AdvancedBase } = require("@heyputer/putility");
const EmitterFeature = require("@heyputer/putility/src/features/EmitterFeature");
const { Context } = require("./util/context");
const { ExtensionServiceState } = require("./ExtensionService");

/**
 * This class creates the `extension` global that is seen by Puter backend
 * extensions.
 */
class Extension extends AdvancedBase {
    static FEATURES = [
        EmitterFeature({
            decorators: [
                fn => Context.get(undefined, {
                    allow_fallback: true,
                }).abind(fn)
            ]
        }),
    ];

    constructor (...a) {
        super(...a);
        this.service = null;
        this.ensure_service_();
    }

    example () {
        console.log('Example method called by an extension.');
    }

    /**
     * This will get a database instance from the default service.
     */
    get db () {
        const db = this.service.values.get('db');
        if ( ! db ) {
            throw new Error(
                'extension tried to access database before it was ' +
                'initialized'
            );
        }
        return db;
    }

    /**
     * This will create a GET endpoint on the default service.
     * @param {*} path - route for the endpoint
     * @param {*} handler - function to handle the endpoint
     * @param {*} options - options like noauth (bool) and mw (array)
     */
    get (path, handler, options) {
        // this extension will have a default service
        this.ensure_service_();

        // handler and options may be flipped
        if ( typeof handler === 'object' ) {
            [handler, options] = [options, handler];
        }
        if ( ! options ) options = {};

        this.service.register_route_handler_(path, handler, {
            ...options,
            methods: ['GET'],
        });
    }

    /**
     * This will create a POST endpoint on the default service.
     * @param {*} path - route for the endpoint
     * @param {*} handler - function to handle the endpoint
     * @param {*} options - options like noauth (bool) and mw (array)
     */
    post (path, handler, options) {
        // this extension will have a default service
        this.ensure_service_();

        // handler and options may be flipped
        if ( typeof handler === 'object' ) {
            [handler, options] = [options, handler];
        }
        if ( ! options ) options = {};

        this.service.register_route_handler_(path, handler, {
            ...options,
            methods: ['POST'],
        });
    }

    /**
     * This method will create the "default service" for an extension.
     * This is specifically for Puter extensions that do not define their
     * own service classes.
     * 
     * @returns {void}
     */
    ensure_service_ () {
        if ( this.service ) {
            return;
        }

        this.service = new ExtensionServiceState({
            extension: this,
        });
    }
}

module.exports = {
    Extension,
}
