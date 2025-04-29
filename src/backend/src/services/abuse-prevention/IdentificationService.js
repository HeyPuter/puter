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
const { AdvancedBase } = require("@heyputer/putility");
const BaseService = require("../BaseService");
const { Context } = require("../../util/context");
const config = require("../../config");


/**
* @class Requester
* @classdesc This class represents a requester in the system. It encapsulates
* information about the requester's user-agent, IP address, origin, referer, and
* other relevant details. The class includes methods to create instances from
* request objects, check if the referer or origin is from Puter, and serialize
* the requester's information. It also includes a method to get a unique identifier
* based on the requester's IP address.
*/
class Requester {
    constructor (o) {
        for ( const k in o ) this[k] = o[k];
    }
    static create (o) {
        return new Requester(o);
    }
    static from_request (req) {

        const has_referer = req.headers['referer'] !== undefined;
        let referer_url;
        let referer_origin;
        if ( has_referer ) {
            try {
                referer_url = new URL(req.headers['referer']);
                referer_origin = referer_url.origin;
            } catch (e) {
                // URL is invalid; referer_url and referer_origin will be undefined
            }
        }

        return new Requester({
            ua: req.headers['user-agent'],
            ip: req.connection.remoteAddress,
            ip_forwarded: req.headers['x-forwarded-for'],
            ip_user: req.headers['x-forwarded-for'] ||
                req.connection.remoteAddress,
            origin: req.headers['origin'],
            referer: req.headers['referer'],
            referer_origin,
        });
    }


    /**
    * Checks if the referer origin is from Puter.
    *
    * @returns {boolean} True if the referer origin matches any of the configured Puter origins, otherwise false.
    */
    is_puter_referer () {
        const puter_origins = [
            config.origin,
            config.api_base_url,
        ]
        return puter_origins.includes(this.referer_origin);
    }


    /**
    * Checks if the request origin is from a known Puter origin.
    *
    * @returns {boolean} - Returns true if the request origin matches one of the known Puter origins, false otherwise.
    */
    is_puter_origin () {
        const puter_origins = [
            config.origin,
            config.api_base_url,
        ]
        return puter_origins.includes(this.origin);
    }


    /**
    * @method get rl_identifier
    * @description Retrieves the rate-limiter identifier, which is either the forwarded IP or the direct IP.
    * @returns {string} The IP address used for rate-limiting purposes.
    */
    get rl_identifier () {
        return this.ip_forwarded || this.ip;
    }


    /**
    * Serializes the Requester object into a plain JavaScript object.
    *
    * This method converts the properties of the Requester instance into a plain object,
    * making it suitable for serialization (e.g., for JSON).
    *
    * @returns {Object} The serialized representation of the Requester object.
    */
    serialize () {
        return {
            ua: this.ua,
            ip: this.ip,
            ip_forwarded: this.ip_forwarded,
            referer: this.referer,
            referer_origin: this.referer_origin,
        };
    }

}

// DRY: (3/3) - src/util/context.js; move install() to base class
/**
* @class RequesterIdentificationExpressMiddleware
* @extends AdvancedBase
* @description This class extends AdvancedBase and provides middleware functionality for identifying the requester in an Express application.
* It registers initializers, installs the middleware on the Express application, and runs the middleware to identify and log details about the requester.
* The class uses the 'isbot' module to determine if the requester is a bot.
*/
class RequesterIdentificationExpressMiddleware extends AdvancedBase {
    static MODULES = {
        isbot: require('isbot'),
    }
    register_initializer (initializer) {
        this.value_initializers_.push(initializer);
    }
    install (app) {
        app.use(this.run.bind(this));
    }
    async run (req, res, next) {
        const x = Context.get();

        const requester = Requester.from_request(req);
        const is_bot = this.modules.isbot(requester.ua);
        requester.is_bot = is_bot;

        x.set('requester', requester);
        req.requester = requester;

        if ( requester.is_bot ) {
            this.log.info('bot detected', requester.serialize());
        }

        next();
    }
}


/**
* @class IdentificationService
* @extends BaseService
* @description The IdentificationService class is responsible for handling the identification of requesters in the application.
* It extends the BaseService class and utilizes the RequesterIdentificationExpressMiddleware to process and identify requesters.
* This service ensures that requester information is properly logged and managed within the application context.
*/
class IdentificationService extends BaseService {
    /**
    * Constructs the IdentificationService instance.
    *
    * This method initializes the service by creating an instance of
    * RequesterIdentificationExpressMiddleware and assigning it to the `mw` property.
    *
    * @returns {void}
    */
    _construct () {
        this.mw = new RequesterIdentificationExpressMiddleware();
    }
    /**
    * Initializes the middleware logger.
    *
    * This method sets the logger for the `RequesterIdentificationExpressMiddleware` instance.
    * It does not take any parameters and does not return any value.
    *
    * @method
    * @name _init
    */
    _init () {
        this.mw.log = this.log;
    }
    /**
    * We need to listen to this event to install a context-aware middleware
    */
    async ['__on_install.middlewares.context-aware'] (_, { app }) {
        this.mw.install(app);
    }
}

module.exports = {
    IdentificationService,
};
