// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o-mini"}}
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
const eggspress = require("./lib/eggspress.js");
const { Context, ContextExpressMiddleware } = require("../../util/context.js");
const BaseService = require("../../services/BaseService.js");

const config = require('../../config.js');
var http = require('http');
const auth = require('../../middleware/auth.js');
const measure = require('../../middleware/measure.js');
const { surrounding_box, es_import_promise } = require('../../fun/dev-console-ui-utils.js');

const relative_require = require;
const strutil = require('@heyputer/putility').libs.string;

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
        ['on-finished']: require('on-finished'),
        morgan: require('morgan'),
    };

    _construct () {
        this.undefined_origin_allowed = [];
    }

    allow_undefined_origin (route) {
        this.undefined_origin_allowed.push(route);
    }

    /**
    * This method initializes the backend web server for Puter. It sets up the Express app, configures middleware, and starts the HTTP server.
    *
    * @param {Express} app - The Express app instance to configure.
    * @returns {void}
    * @private
    */
    // comment above line 44 in WebServerService.js
    async ['__on_boot.consolidation'] () {
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

        // Register after other services registers theirs: Options for all requests (for CORS)
        app.options('/*', (_req, res) => {
            return res.sendStatus(200);
        });

        this.log.debug('web server setup done');
    }

    install_post_middlewares_ ({ app }) {
        app.use(async (req, res, next) => {
            const svc_event = this.services.get('event');

            const event = {
                req, res,
                end_: false,
                end () {
                    this.end_ = true;
                }
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
    async ['__on_boot.activation'] () {
        const services = this.services;
        await services.emit('start.webserver');
        await services.emit('ready.webserver');
        this.log.info('in case you care, ready.webserver hooks are done');
    }

    /**
    * This method starts the web server by listening on the specified port. It tries multiple ports if the first one is in use.
    * If the `config.http_port` is set to 'auto', it will try to find an available port in a range of 4100 to 4299.
    * Once the server is up and running, it emits the 'start.webserver' and 'ready.webserver' events.
    * If the `config.env` is set to 'dev' and `config.no_browser_launch` is false, it will open the Puter URL in the default browser.
    *
    * @return {Promise} A promise that resolves when the server is up and running.
    */
    async ['__on_start.webserver'] () {
        await es_import_promise;

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
            if ( auto_port ) this.log.debug('trying port: ' + port);
            try {
                server = http.createServer(this.app).listen(port);
                server.timeout = 1000 * 60 * 60 * 2; // 2 hours
                let should_continue = false;
                await new Promise((rslv, rjct) => {
                    server.on('error', e => {
                        if ( e.code === 'EADDRINUSE' ) {
                            if ( ! is_last_port && e.code === 'EADDRINUSE' ) {
                                this.log.info('port in use: ' + port);
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
                    })
                })
                if ( should_continue ) continue;
            } catch (e) {
                if ( ! is_last_port && e.code === 'EADDRINUSE' ) {
                    this.log.info('port in use:' + port);
                    continue;
                }
                throw e;
            }
            config.http_port = port;
            break;
        }
        ports_to_try = null; // GC

        const url = config.origin;

        // Open the browser to the URL of Puter
        // (if we are in development mode only)
        if(config.env === 'dev' && ! config.no_browser_launch) {
            try{
                const openModule = await import('open');
                openModule.default(url);
            }catch(e){
                console.log('Error opening browser', e);
            }
        }
        

        if ( ! config.disable_fun ) this.print_puter_logo_();

        const link = `\x1B[34;1m${strutil.osclink(url)}\x1B[0m`;
        const lines = [
            `Puter is now live at: ${link}`,
        ];
        this.startup_widget = () => {

            const lengths = [
                (`Puter is now live at: `).length + url.length,
                lines[1].length,
            ];
            surrounding_box('34;1', lines, lengths);
            return lines;
        };
        if ( this.config.old_widget_behavior ) {
            const svc_devConsole = this.services.get('dev-console', { optional: true });
            if ( svc_devConsole ) svc_devConsole.add_widget(this.startup_widget);
        } else {
            const svc_devConsole = this.services.get('dev-console', { optional: true });
            if ( svc_devConsole ) svc_devConsole.notice({
                colors: { bg: '38;2;0;0;0;48;2;0;202;252;1', bginv: '38;2;0;202;252' },
                title: 'Puter is live!',
                lines,
            });
        }

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
            if (socket.handshake.auth.auth_token) {
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
                    console.log('socket auth err', e);
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
                user: socket.user
            });
            socket.on('puter_is_actually_open', async (msg) => {
                await context.sub({
                    actor: socket.actor,
                }).arun(async () => {
                    await svc_event.emit('web.socket.user-connected', {
                        socket,
                        user: socket.user
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
        this._register_commands(this.services.get('commands'));

        this.middlewares = { auth };

        const require = this.require;

        const config = this.global_config;
        new ContextExpressMiddleware({
            parent: globalThis.root_context.sub({
                puter_environment: Context.create({
                    env: config.env,
                    version: relative_require('../../../package.json').version,
                }),
            }, 'mw')
        }).install(app);

        app.use(async (req, res, next) => {
            req.services = this.services;
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
                    const [method, url, status, responseTime] = message.split(' ')
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
                        const url = new URL('https://example.com' + u);
                        const search = url.searchParams;
                        for ( const key of search.keys() ) {
                            if ( key.startsWith('puter.auth.') ) search.delete(key);
                        }
                        return url.pathname + '?' + search.toString();
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

        app.use(async function(req, res, next) {
            // Express does not document that this can be undefined.
            // The browser likely doesn't follow the HTTP/1.1 spec
            // (bot client?) and express is handling this badly by
            // not setting the header at all. (that's my theory)
            if ( req.hostname === undefined ) {
                res.status(400).send(
                    'Please verify your browser is up-to-date.'
                );
                return;
            }

            return next();
        });

        // Validate host header against allowed domains to prevent host header injection
        // https://www.owasp.org/index.php/Host_Header_Injection
        app.use((req, res, next)=>{
            const allowedDomains = [
                config.domain.toLowerCase(),
                config.static_hosting_domain.toLowerCase(),
                'at.' + config.static_hosting_domain.toLowerCase(),
            ];

            if ( config.allow_nipio_domains ) {
                allowedDomains.push('nip.io');
            }

            // Retrieve the Host header and ensure it's in a valid format
            const hostHeader = req.headers.host;

            if ( ! config.allow_no_host_header && ! hostHeader ) {
                return res.status(400).send('Missing Host header.');
            }

            if ( config.allow_all_host_values ) {
                next();
                return;
            }

            // Parse the Host header to isolate the hostname (strip out port if present)
            const hostName = hostHeader.split(':')[0].trim().toLowerCase();

            // Check if the hostname matches any of the allowed domains or is a subdomain of an allowed domain
            if (allowedDomains.some(allowedDomain => hostName === allowedDomain || hostName.endsWith('.' + allowedDomain))) {
                next(); // Proceed if the host is valid
            } else {
                if ( ! config.custom_domains_enabled ) {
                    return res.status(400).send('Invalid Host header.');
                }
                req.is_custom_domain = true;
                next();
            }
        });

        // Validate IP with any IP checkers
        app.use(async (req, res, next)=>{
            const svc_event = this.services.get('event');
            const event = {
                allow: true,
                ip: req.headers?.['x-forwarded-for'] ||
                    req.connection?.remoteAddress,
            };

            if ( ! this.config.disable_ip_validate_event ) {
                await svc_event.emit('ip.validate', event);
            }

            // rules that don't apply to notification endpoints
            const undefined_origin_allowed = config.undefined_origin_allowed || this.undefined_origin_allowed.some(rule => {
                if ( typeof rule === 'string' ) return rule === req.path;
                return rule.test(req.path);
            });
            if ( ! undefined_origin_allowed ) {
                // check if no origin
                if ( req.method === 'POST' && req.headers.origin === undefined ) {
                    event.allow = false;
                }
            }
            if ( ! event.allow ) {
                return res.status(403).send('Forbidden');
            }
            next();
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

        app.use(express.json({limit: '50mb'}));

        const cookieParser = require('cookie-parser');
        app.use(cookieParser({limit: '50mb'}));

        // gzip compression for all requests
        const compression = require('compression');
        app.use(compression());

        // Helmet and other security
        const helmet = require('helmet');
        app.use(helmet.noSniff());
        app.use(helmet.hsts());
        app.use(helmet.ieNoOpen());
        app.use(helmet.permittedCrossDomainPolicies());
        app.use(helmet.xssFilter());
        // app.use(helmet.referrerPolicy());
        app.disable('x-powered-by');

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

        const uaParser = require('ua-parser-js');
        app.use(function (req, res, next) {
            const ua_header = req.headers['user-agent'];
            const ua = uaParser(ua_header);
            req.ua = ua;
            next();
        });

        app.use(function (req, res, next) {
            req.co_isolation_enabled =
                ['Chrome', 'Edge'].includes(req.ua.browser.name)
                && (Number(req.ua.browser.major) >= 110);
            next();
        });

        app.use(function (req, res, next) {
            const origin = req.headers.origin;

            const is_site =
                req.hostname.endsWith(config.static_hosting_domain) ||
                req.hostname === 'docs.puter.com'
                ;
            const is_popup = !! req.query.embedded_in_popup;
            const is_parent_co = !! req.query.cross_origin_isolated;
            const is_app = !! req.query['puter.app_instance_id'];

            const co_isolation_okay =
                (!is_popup || is_parent_co) &&
                (is_app || !is_site) &&
                req.co_isolation_enabled
                ;

            if ( req.path === '/signup' || req.path === '/login' || req.path.startsWith('/extensions/') ) {
                res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
            }
            // Website(s) to allow to connect
            if (
                config.experimental_no_subdomain ||
                req.subdomains[req.subdomains.length-1] === 'api'
            ) {
                res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
            }

            // Request methods to allow
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK');

            const allowed_headers = [
                "Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization", "sentry-trace", "baggage",
                "Depth", "Destination", "Overwrite", "If", "Lock-Token", "DAV"
            ];

            // Request headers to allow
            res.header("Access-Control-Allow-Headers", allowed_headers.join(', '));

            // Set to true if you need the website to include cookies in the requests sent
            // to the API (e.g. in case you use sessions)
            // res.setHeader('Access-Control-Allow-Credentials', true);

            // Needed for SharedArrayBuffer
            // NOTE: This is put behind a configuration flag because we
            //       need some experimentation to ensure the interface
            //       between apps and Puter doesn't break.
            if ( config.cross_origin_isolation && co_isolation_okay ) {
                res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
                res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
            }
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

            // Pass to next layer of middleware

            // disable iframes on the main domain
            if ( req.hostname === config.domain ) {
                // disable iframes
                res.setHeader('X-Frame-Options', 'SAMEORIGIN');
            }

            next();
        });
    }

    _register_commands (commands) {
        commands.registerCommands('web', [
            {
                id: 'dismiss',
                description: 'Dismiss the startup message',
                handler: async (_, log) => {
                    if ( ! this.startup_widget ) return;
                    const svc_devConsole = this.services.get('dev-console', { optional: true });
                    if ( svc_devConsole ) svc_devConsole.remove_widget(this.startup_widget);
                    const lines = this.startup_widget();
                    for ( const line of lines ) log.log(line);
                    this.startup_widget = null;
                }
            }
        ]);
    }

    /**
    * Prints the Puter logo seen in the console after the server is started.
    * 
    * Depending on the size of the terminal, a different version of the
    * logo is displayed. The logo is displayed in blue text.
    * 
    * @returns {void}
    * @private
    */
    // comment above line 497
    print_puter_logo_() {
        if ( this.global_config.env !== 'dev' ) return;
        const logos = require('../../fun/logos.js');
        let last_logo = undefined;
        for ( const logo of logos ) {
            if ( logo.sz <= (process.stdout.columns ?? 0) ) {
                last_logo = logo;
            } else break;
        }
        if ( last_logo ) {
            const lines = last_logo.txt.split('\n');
            const width = process.stdout.columns;
            const pad = (width - last_logo.sz) / 2;
            const pad_left = Math.floor(pad);
            const pad_right = Math.ceil(pad);
            for ( let i = 0 ; i < lines.length ; i++ ) {
                lines[i] = ' '.repeat(pad_left) + lines[i] + ' '.repeat(pad_right);
            }
            const txt = lines.join('\n');
            console.log('\n\x1B[34;1m' + txt + '\x1B[0m\n');
        }
        if ( config.os.archbtw ) {
            console.log('\x1B[34;1mPuter is running on Arch btw\x1B[0m');
        }
    }
}

module.exports = WebServerService;
