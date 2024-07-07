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
const { Context } = require("../util/context");
const BaseService = require("./BaseService");
const { stringify_log_entry } = require("./runtime-analysis/LogService");

/**
 * This service registers a middleware that will apply the value of
 * header X-PUTER-DEBUG to the request's Context object.
 *
 * Consequentially, the value of X-PUTER-DEBUG will included in all
 * log messages produced by the request.
 */
class MakeProdDebuggingLessAwfulService extends BaseService {
    static MODULES = {
        fs: require('fs'),
    }
    static ProdDebuggingMiddleware = class ProdDebuggingMiddleware {
        constructor () {
            this.header_name_ = 'x-puter-debug';
        }
        install (app) {
            app.use(this.run.bind(this));
        }
        async run (req, res, next) {
            const x = Context.get();
            x.set('prod-debug', req.headers[this.header_name_]);
            next();
        }
    }
    async _init () {
        // Initialize express middleware
        this.mw = new this.constructor.ProdDebuggingMiddleware();

        // Add logger middleware
        const svc_log = this.services.get('log-service');
        svc_log.register_log_middleware(async log_details => {
            const {
                context,
                log_lvl, crumbs, message, fields, objects,
            } = log_details;

            const maybe_debug_token = context.get('prod-debug');

            if ( ! maybe_debug_token ) return;

            // Log to an additional log file so this is easier to find
            const outfile = svc_log.get_log_file(`debug-${maybe_debug_token}.log`);

            try {
                await this.modules.fs.promises.appendFile(
                    outfile,
                    stringify_log_entry(log_details) + '\n',
                );
            } catch ( e ) {
                console.error(e);
            }

            // Add the prod_debug field to the log message
            return {
                fields: {
                    ...fields,
                    prod_debug: maybe_debug_token,
                }
            };
        });
    }
    async ['__on_install.middlewares.context-aware'] (_, { app }) {
        // Add express middleware
        this.mw.install(app);
    }
}

module.exports = {
    MakeProdDebuggingLessAwfulService,
};
