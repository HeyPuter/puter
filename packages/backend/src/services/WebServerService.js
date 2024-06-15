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
const express = require('express');
const eggspress = require("../api/eggspress");
const { Context, ContextExpressMiddleware } = require("../util/context");
const BaseService = require("./BaseService");

const config = require('../config');
const https = require('https')
var http = require('http');
const fs = require('fs');
const auth = require('../middleware/auth');
const { osclink } = require('../util/strutil');
const { surrounding_box, es_import_promise } = require('../fun/dev-console-ui-utils');
const auth2 = require('../middleware/auth2.js');

class WebServerService extends BaseService {
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

    async ['__on_boot.consolidation'] () {
        const app = this.app;
        const services = this.services;
        await services.emit('install.middlewares.context-aware', { app });
        await services.emit('install.routes', {
            app,
            router_webhooks: this.router_webhooks,
        });
        await services.emit('install.routes-gui', { app });
    }

    async ['__on_boot.activation'] () {
        const services = this.services;
        await services.emit('start.webserver');
        await services.emit('ready.webserver');
        this.print_puter_logo_();
    }

    async ['__on_start.webserver'] () {
        await es_import_promise;

        // error handling middleware goes last, as per the
        // expressjs documentation:
        // https://expressjs.com/en/guide/error-handling.html
        this.app.use(require('../api/api_error_handler'));

        const path = require('path')
        const { jwt_auth } = require('../helpers');

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
            if ( auto_port ) this.log.info('trying port: ' + port);
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

        this.startup_widget = () => {
            const link = `\x1B[34;1m${osclink(url)}\x1B[0m`;
            const lines = [
                "",
                `Puter is now live at: ${link}`,
                `Type web:dismiss to un-stick this message`,
                "",
            ];
            const lengths = [
                0,
                (`Puter is now live at: `).length + url.length,
                lines[2].length,
                0,
            ];
            surrounding_box('34;1', lines, lengths);
            return lines;
        };
        {
            const svc_devConsole = this.services.get('dev-console', { optional: true });
            if ( svc_devConsole ) svc_devConsole.add_widget(this.startup_widget);
        }

        server.timeout = 1000 * 60 * 60 * 2; // 2 hours
        server.requestTimeout = 1000 * 60 * 60 * 2; // 2 hours
        server.headersTimeout = 1000 * 60 * 60 * 2; // 2 hours
        // server.keepAliveTimeout = 1000 * 60 * 60 * 2; // 2 hours

        // Socket.io server instance
        const socketio = require('../socketio.js').init(server);

        // Socket.io middleware for authentication
        socketio.use(async (socket, next) => {
            if (socket.handshake.auth.auth_token) {
                try {
                    let auth_res = await jwt_auth(socket);
                    // successful auth
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

        socketio.on('connection', (socket) => {
            socket.on('disconnect', () => {
            });
            socket.on('trash.is_empty', (msg) => {
                socket.broadcast.to(socket.user.id).emit('trash.is_empty', msg);
                const svc_event = this.services.get('event');
                svc_event.emit('web.socket.user-connected', {
                    user: socket.user
                });
            });
        });
        
        await this.services.emit('install.websockets', { server });
    }

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
                    version: require('../../package.json').version,
                }),
            }, 'mw')
        }).install(app);

        app.use(async (req, res, next) => {
            req.services = this.services;
            next();
        });

        // Instrument logging to use our log service
        {
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
                log.info(message, fields);
            }
            };

            app.use(morgan(':method :url :status :response-time', { stream }));
        }

        app.use((() => {
            // const router = express.Router();
            // router.get('/wut', express.json(), (req, res, next) => {
            //     return res.status(500).send('Internal Error');
            // });
            // return router;

            return eggspress('/wut', {
                allowedMethods: ['GET'],
            }, async (req, res, next) => {
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
            if( req.hostname === undefined ) {
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
            const allowedDomains = [config.domain.toLowerCase(), config.static_hosting_domain.toLowerCase()];

            // Retrieve the Host header and ensure it's in a valid format
            const hostHeader = req.headers.host;

            if (!hostHeader) {
                return res.status(400).send('Missing Host header.');
            }

            // Parse the Host header to isolate the hostname (strip out port if present)
            const hostName = hostHeader.split(':')[0].trim().toLowerCase();

            // Check if the hostname matches any of the allowed domains or is a subdomain of an allowed domain
            if (allowedDomains.some(allowedDomain => hostName === allowedDomain || hostName.endsWith('.' + allowedDomain))) {
                next(); // Proceed if the host is valid
            } else {
                return res.status(400).send('Invalid Host header.');
            }
        })

        // Web hooks need a router that occurs before JSON parse middleware
        // so that signatures of the raw JSON can be verified
        this.router_webhooks = express.Router();
        app.use(this.router_webhooks);

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

        app.use(function (req, res, next) {
            const origin = req.headers.origin;

            if ( req.path === '/signup' || req.path === '/login' ) {
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
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

            const allowed_headers = [
                "Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization",
            ];

            // Request headers to allow
            res.header("Access-Control-Allow-Headers", allowed_headers.join(', '));

            // Set to true if you need the website to include cookies in the requests sent
            // to the API (e.g. in case you use sessions)
            // res.setHeader('Access-Control-Allow-Credentials', true);

            //needed for SharedArrayBuffer
            // res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
            // res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
            // Pass to next layer of middleware

            // disable iframes on the main domain
            if ( req.hostname === config.domain ) {
                // disable iframes
                res.setHeader('X-Frame-Options', 'SAMEORIGIN');
            }

            next();
        });

        // Options for all requests (for CORS)
        app.options('/*', (_, res) => {
            return res.sendStatus(200);
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

    print_puter_logo_() {
        if ( this.global_config.env !== 'dev' ) return;
        const logos = require('../fun/logos.js');
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
            const asymmetrical = pad % 1 !== 0;
            const pad_left = Math.floor(pad);
            const pad_right = Math.ceil(pad);
            for ( let i = 0 ; i < lines.length ; i++ ) {
                lines[i] = ' '.repeat(pad_left) + lines[i] + ' '.repeat(pad_right);
            }
            const txt = lines.join('\n');
            console.log('\n\x1B[34;1m' + txt + '\x1B[0m\n');
        }
    }
}

module.exports = WebServerService;
