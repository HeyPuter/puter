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
const express = require('express');
const eggspress = require('./lib/eggspress.js');
const { Context, ContextExpressMiddleware } = require('../../util/context.js');
const BaseService = require('../../services/BaseService.js');

const config = require('../../config.js');
var http = require('http');
const auth = require('../../middleware/auth.js');
const measure = require('../../middleware/measure.js');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const relative_require = require;

/**
* This class, WebServerService, is responsible for starting and managing the Puter web server.
* It initializes the Express app, sets up middlewares, routes, and handles authentication and web sockets.
* It also validates the host header and IP addresses to prevent security vulnerabilities.
*/
class WebServerService extends BaseService {
    static CONCERN = 'web';

    static MODULES = {
        https: require('https'),
        http: require('http'),
        fs: require('fs'),
        express: require('express'),
        helmet: require('helmet'),
        cookieParser: require('cookie-parser'),
        compression: require('compression'),
        'on-finished': require('on-finished'),
        morgan: require('morgan'),
    };

    allowedRoutesWithUndefinedOrigins = [];

    allow_undefined_origin (route) {
        this.allowedRoutesWithUndefinedOrigins.push(route);
    }

    /**
    * This method initializes the backend web server for Puter. It sets up the Express app, configures middleware, and starts the HTTP server.
    *
    * @param {Express} app - The Express app instance to configure.
    * @returns {void}
    * @private
    */
    // comment above line 44 in WebServerService.js
    async '__on_boot.consolidation' () {
        const app = this.app;
        const services = this.services;
        await services.emit('install.middlewares.early', { app });
        await services.emit('install.middlewares.context-aware', { app });
        this.install_post_middlewares_({ app });
        await services.emit('install.routes', {
            app,
            router_webhooks: this.router_webhooks,
        });
        await services.emit('install.routes-gui', { app });

        // Catch-all 404 for unmatched routes (e.g. api subdomain with unknown path)
        // There seem to be some cases (ex: other subdomains) where this doesn't work
        // as intended still, but this is an improvement over the previous behavior.
        app.use((req, res) => {
            res.status(404).send('Not Found');
        });

        this.log.debug('web server setup done');
    }

    install_post_middlewares_ ({ app }) {
        app.use(async (req, res, next) => {
            const svc_event = this.services.get('event');

            const event = {
                req,
                res,
                end_: false,
                end () {
                    this.end_ = true;
                },
            };
            await svc_event.emit('request.will-be-handled', event);
            if ( ! event.end_ ) next();
        });
    }

    /**
    * Starts the web server and listens for incoming connections.
    * This method sets up the Express app, sets up middleware, and starts the server on the specified port.
    * It also sets up the Socket.io server for real-time communication.
    *
    * @returns {Promise<void>} A promise that resolves once the server is started.
    */
    async '__on_boot.activation' () {
        const services = this.services;
        await services.emit('start.webserver');
        await services.emit('ready.webserver');
        console.log('in case you care, ready.webserver hooks are done');
    }

    /**
    * This method starts the web server by listening on the specified port. It tries multiple ports if the first one is in use.
    * If the `config.http_port` is set to 'auto', it will try to find an available port in a range of 4100 to 4299.
    * Once the server is up and running, it emits the 'start.webserver' and 'ready.webserver' events.
    * If the `config.env` is set to 'dev' and `config.no_browser_launch` is false, it will open the Puter URL in the default browser.
    *
    * @return {Promise} A promise that resolves when the server is up and running.
    */
    async '__on_start.webserver' () {
        // error handling middleware goes last, as per the
        // expressjs documentation:
        // https://expressjs.com/en/guide/error-handling.html
        this.app.use(require('./lib/api_error_handler.js'));

        const { jwt_auth } = require('../../helpers.js');

        config.http_port = process.env.PORT ?? config.http_port;

        globalThis.deployment_type =
            config.http_port === 5101 ? 'green' :
                config.http_port === 5102 ? 'blue' :
                    'not production';

        let server;

        const auto_port = config.http_port === 'auto';
        let ports_to_try = auto_port ? (() => {
            const ports = [];
            for ( let i = 0 ; i < 20 ; i++ ) {
                ports.push(4100 + i);
            }
            return ports;
        })() : [Number.parseInt(config.http_port)];

        for ( let i = 0 ; i < ports_to_try.length ; i++ ) {
            const port = ports_to_try[i];
            const is_last_port = i === ports_to_try.length - 1;
            if ( auto_port ) this.log.debug(`trying port: ${ port}`);
            try {
                server = http.createServer(this.app).listen(port);
                server.timeout = 1000 * 60 * 60 * 2; // 2 hours
                let should_continue = false;
                await new Promise((rslv, rjct) => {
                    server.on('error', e => {
                        if ( e.code === 'EADDRINUSE' ) {
                            if ( !is_last_port && e.code === 'EADDRINUSE' ) {
                                this.log.info(`port in use: ${ port}`);
                                should_continue = true;
                            }
                            rslv();
                        } else {
                            rjct(e);
                        }
                    });
                    /**
                    * Starts the web server.
                    *
                    * This method is responsible for creating the HTTP server, setting up middleware, and starting the server on the specified port. If the specified port is "auto", it will attempt to find an available port within a range.
                    *
                    * @returns {Promise<void>}
                    */
                    // Add this comment above line 110
                    // (line 110 of the provided code)
                    server.on('listening', () => {
                        rslv();
                    });
                });
                if ( should_continue ) continue;
            } catch (e) {
                if ( !is_last_port && e.code === 'EADDRINUSE' ) {
                    this.log.info(`port in use:${ port}`);
                    continue;
                }
                throw e;
            }
            config.http_port = port;
            break;
        }
        ports_to_try = null; // GC

        const url = config.origin;

        const args = yargs(hideBin(process.argv)).argv;
        if ( args['server'] ) {
            (async () => {
                (await import('./../../../../../tools/auth_gui.js')).default(args['puter-backend']);
            })();
            config.no_browser_launch = true;
        }
        // Open the browser to the URL of Puter
        // (if we are in development mode only)
        if ( config.env === 'dev' && !config.no_browser_launch ) {
            try {
                const openModule = await import('open');
                openModule.default(url);
            } catch (e) {
                console.log('Error opening browser', e);
            }
        }

        const link = `\x1B[34;1m${url}\x1B[0m`;
        const lines = [
            `Puter is now live at: ${link}`,
            `listening on port: ${config.http_port}`,
        ];
        const realConsole = globalThis.original_console_object ?? console;
        lines.forEach(line => realConsole.log(line));

        realConsole.log('\n************************************************************');
        realConsole.log(`* Puter is now live at: ${url}`);
        realConsole.log('************************************************************');

        server.timeout = 1000 * 60 * 60 * 2; // 2 hours
        server.requestTimeout = 1000 * 60 * 60 * 2; // 2 hours
        server.headersTimeout = 1000 * 60 * 60 * 2; // 2 hours
        // server.keepAliveTimeout = 1000 * 60 * 60 * 2; // 2 hours

        // Socket.io server instance
        // const socketio = require('../../socketio.js').init(server);

        // TODO: ^ Replace above line with the following code:
        await this.services.emit('install.socketio', { server });
        const socketio = this.services.get('socketio').io;

        // Socket.io middleware for authentication
        socketio.use(async (socket, next) => {
            if ( socket.handshake.auth.auth_token ) {
                try {
                    let auth_res = await jwt_auth(socket);
                    // successful auth
                    socket.actor = auth_res.actor;
                    socket.user = auth_res.user;
                    socket.token = auth_res.token;
                    // join user room
                    socket.join(socket.user.id);

                    // setTimeout 0 is needed because we need to send
                    // the notifications after this handler is done
                    // setTimeout(() => {
                    // }, 1000);
                    next();
                } catch (e) {
                    console.warn('socket auth err', e);
                }
            }
        });

        const context = Context.get();
        socketio.on('connection', (socket) => {
            socket.on('disconnect', () => {
            });
            socket.on('trash.is_empty', (msg) => {
                socket.broadcast.to(socket.user.id).emit('trash.is_empty', msg);
            });
            const svc_event = this.services.get('event');
            svc_event.emit('web.socket.connected', {
                socket,
                user: socket.user,
            });
            socket.on('puter_is_actually_open', async (_msg) => {
                await context.sub({
                    actor: socket.actor,
                }).arun(async () => {
                    await svc_event.emit('web.socket.user-connected', {
                        socket,
                        user: socket.user,
                    });
                });
            });
        });

        this.server_ = server;
        await this.services.emit('install.websockets');
    }

    /**
    * Starts the Puter web server and sets up routes, middleware, and error handling.
    *
    * @param {object} services - An object containing all services available to the web server.
    * @returns {Promise<void>} A promise that resolves when the web server is fully started.
    */
    get_server () {
        return this.server_;
    }

    /**
    * Handles starting and managing the Puter web server.
    *
    * @param {Object} services - An object containing all services.
    */
    async _init () {
        const app = express();
        this.app = app;

        app.set('services', this.services);

        this.middlewares = { auth };

        const require = this.require;

        const config = this.global_config;
        new ContextExpressMiddleware({
            parent: globalThis.root_context.sub({
                puter_environment: Context.create({
                    env: config.env,
                    version: relative_require('../../../package.json').version,
                }),
            }, 'mw'),
        }).install(app);

        app.use(async (req, res, next) => {
            req.services = this.services;
            next();
        });

        // When the user visits the main origin (not api/dav subdomain) with ?auth_token=<GUI token>
        // (e.g. QR login), set the HTTP-only session cookie so user-protected endpoints work.
        app.use(async (req, res, next) => {
            const has_subdomain = req.hostname.slice(0, -1 * (config.domain.length + 1)) !== '';
            if ( has_subdomain ) return next();

            const token = req.query?.auth_token;
            if ( !token || typeof token !== 'string' ) return next();

            try {
                const svc_auth = req.services.get('auth');
                const cleanToken = token.replace('Bearer ', '').trim();
                const actor = await svc_auth.authenticate_from_token(cleanToken);
                const session_token = svc_auth.create_session_token_for_session(
                    actor.type.user,
                    actor.type.session,
                );
                res.cookie(config.cookie_name, session_token, {
                    sameSite: 'none',
                    secure: true,
                    httpOnly: true,
                });
            } catch ( e ) {
                console.log('query auth token (QR Code login probably) failed');
                console.error(e);
            }
            next();
        });

        // Measure data transfer amounts
        app.use(measure());

        // Instrument logging to use our log service
        {
            // Switch log function at config time; info log is configurable
            const logfn = (config.logging ?? []).includes('http')
                ? (log, { message, fields }) => {
                    log.info(message);
                    log.debug(message, fields);
                }
                : (log, { message, fields }) => {
                    log.debug(message, fields);
                };

            const morgan = require('morgan');
            const stream = {
                write: (message) => {
                    const [method, url, status, responseTime] = message.split(' ');
                    const fields = {
                        method,
                        url,
                        status: parseInt(status, 10),
                        responseTime: parseFloat(responseTime),
                    };
                    if ( url.includes('android-icon') ) return;

                    // remove `puter.auth.*` query params
                    const safe_url = (u => {
                        // We need to prepend an arbitrary domain to the URL
                        const url = new URL(`https://example.com${ u}`);
                        const search = url.searchParams;
                        for ( const key of search.keys() ) {
                            if ( key.startsWith('puter.auth.') ) search.delete(key);
                        }
                        return `${url.pathname }?${ search.toString()}`;
                    })(fields.url);
                    fields.url = safe_url;
                    // re-write message
                    message = [
                        fields.method, fields.url,
                        fields.status, fields.responseTime,
                    ].join(' ');

                    const log = this.services.get('log-service').create('morgan');
                    try {
                        this.context.arun(() => {
                            logfn(log, { message, fields });
                        });
                    } catch (e) {
                        console.log('failed to log this message properly:', message, fields);
                        console.error(e);
                    }
                },
            };

            app.use(morgan(':method :url :status :response-time', { stream }));
        }

        /**
        * Initialize the web server, start it, and handle any related logic.
        *
        * This method is responsible for creating the server and listening on the
        * appropriate port. It also sets up middleware, routes, and other necessary
        * configurations.
        *
        * @returns {Promise<void>} A promise that resolves once the server is up and running.
        */
        app.use((() => {
            // const router = express.Router();
            // router.get('/wut', express.json(), (req, res, next) => {
            //     return res.status(500).send('Internal Error');
            // });
            // return router;

            return eggspress('/wut', {
                allowedMethods: ['GET'],
            }, async (req, res, _next) => {
                // throw new Error('throwy error');
                return res.status(200).send('test endpoint');
            });
        })());

        (() => {
            const onFinished = require('on-finished');
            app.use((req, res, next) => {
                onFinished(res, () => {
                    if ( res.statusCode !== 500 ) return;
                    if ( req.__error_handled ) return;
                    const alarm = this.services.get('alarm');
                    alarm.create('responded-500', 'server sent a 500 response', {
                        error: req.__error_source,
                        url: req.url,
                        method: req.method,
                        body: req.body,
                        headers: req.headers,
                    });
                });
                next();
            });
        })();

        app.use(async function (req, res, next) {
            // Express does not document that this can be undefined.
            // The browser likely doesn't follow the HTTP/1.1 spec
            // (bot client?) and express is handling this badly by
            // not setting the header at all. (that's my theory)
            if ( req.hostname === undefined ) {
                res.status(400).send(
                                'Please verify your browser is up-to-date.');
                return;
            }

            return next();
        });

        // Web hooks need a router that occurs before JSON parse middleware
        // so that signatures of the raw JSON can be verified
        this.router_webhooks = express.Router();
        app.use(this.router_webhooks);

        app.use((req, res, next) => {
            if ( req.get('x-amz-sns-message-type') ) {
                req.headers['content-type'] = 'application/json';
            }
            next();
        });

        // remove object and array query parameters
        app.use(function (req, res, next) {
            for ( let k in req.query ) {
                if ( req.query[k] === undefined || req.query[k] === null ) {
                    continue;
                }

                const allowed_types = ['string', 'number', 'boolean'];
                if ( ! allowed_types.includes(typeof req.query[k]) ) {
                    req.query[k] = undefined;
                }
            }
            next();
        });

    }
}

module.exports = WebServerService;
