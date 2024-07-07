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
const { AdvancedBase } = require("@heyputer/puter-js-common");
const BaseService = require("../BaseService");
const { Context } = require("../../util/context");
const config = require("../../config");

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
            origin: req.headers['origin'],
            referer: req.headers['referer'],
            referer_origin,
        });
    }

    is_puter_referer () {
        const puter_origins = [
            config.origin,
            config.api_base_url,
        ]
        return puter_origins.includes(this.referer_origin);
    }

    is_puter_origin () {
        const puter_origins = [
            config.origin,
            config.api_base_url,
        ]
        return puter_origins.includes(this.origin);
    }

    get rl_identifier () {
        return this.ip_forwarded || this.ip;
    }

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

class IdentificationService extends BaseService {
    _construct () {
        this.mw = new RequesterIdentificationExpressMiddleware();
    }
    _init () {
        this.mw.log = this.log;
    }
    async ['__on_install.middlewares.context-aware'] (_, { app }) {
        this.mw.install(app);
    }
}

module.exports = {
    IdentificationService,
};
