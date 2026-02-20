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
const multer = require('multer');
const multest = require('@heyputer/multest');
const api_error_handler = require('./api_error_handler.js');

const APIError = require('../../../api/APIError.js');
const { Context } = require('../../../util/context.js');
const { subdomain } = require('../../../helpers.js');
const config = require('../../../config.js');

/**
 * eggspress() is a factory function for creating express routers.
 *
 * @param {*} route the route to the router
 * @param {*} settings the settings for the router. The following
 *  properties are supported:
 * - auth: whether or not to use the auth middleware
 * - fs: whether or not to use the fs middleware
 * - json: whether or not to use the json middleware
 * - customArgs: custom arguments to pass to the router
 * - allowedMethods: the allowed HTTP methods
 * @param {*} handler the handler for the router
 * @returns {express.Router} the router
 */
module.exports = function eggspress (route, settings, handler) {
    const router = express.Router();
    const mw = [];
    const afterMW = [];
    let accessControlParserMW = null;

    const _defaultJsonOptions = {};
    if ( settings.jsonCanBeLarge ) {
        _defaultJsonOptions.limit = '10mb';
    }

    // Subdomain should be checked before any other middleware to prevent
    // unnecessary processing and re-sending headers.
    if ( settings.subdomain ) {
        mw.push((req, res, next) => {
            if ( subdomain(req) !== settings.subdomain ) {
                next('route');
                return;
            }
            next();
        });
    }

    const globalMW = {
        validateHostHeader: true,
        validateIP: true,
        cookieParser: true,
        json: true,
        compression: true,
        helmet: true,
        uaParser: true,
        accessControlParser: true,
        ...(settings.webMiddlewares ?? {}),
    };

    if ( globalMW.validateHostHeader ) {
        mw.push((req, res, next) => {
            const allowedDomains = [
                config.domain.toLowerCase(),
                config.static_hosting_domain.toLowerCase(),
                `at.${ config.static_hosting_domain.toLowerCase()}`,
            ];

            if ( config.static_hosting_domain_alt ) {
                allowedDomains.push(config.static_hosting_domain_alt.toLowerCase());
            }

            if ( config.allow_nipio_domains ) {
                allowedDomains.push('nip.io');
            }

            const hostHeader = req.headers.host;
            if ( !config.allow_no_host_header && !hostHeader ) {
                return res.status(400).send('Missing Host header.');
            }

            if ( config.allow_all_host_values ) {
                return next();
            }

            const hostName = hostHeader.split(':')[0].trim().toLowerCase();
            if ( req.path === '/healthcheck' && hostName === config.domain.toLowerCase() ) {
                return next();
            }
            if ( allowedDomains.some(allowedDomain => hostName === allowedDomain || hostName.endsWith(`.${ allowedDomain}`)) ) {
                return next();
            }

            if ( ! config.custom_domains_enabled ) {
                return res.status(400).send('Invalid Host header.');
            }
            req.is_custom_domain = true;
            next();
        });
    }

    if ( globalMW.validateIP ) {
        mw.push(async (req, res, next) => {
            const svc_event = req.services.get('event');
            const svc_web = req.services.get('web-server');
            const event = {
                allow: true,
                ip: req.headers?.['x-forwarded-for'] || req.connection?.remoteAddress,
            };

            if ( ! svc_web.config.disable_ip_validate_event ) {
                await svc_event.emit('ip.validate', event);
            }

            const undefined_origin_allowed =
                config.undefined_origin_allowed ||
                svc_web.allowedRoutesWithUndefinedOrigins.some(rule => {
                    if ( typeof rule === 'string' ) return rule === req.path;
                    return rule.test(req.path);
                });

            if ( ! undefined_origin_allowed ) {
                if ( req.method === 'POST' && req.headers.origin === undefined ) {
                    event.allow = false;
                }
            }

            if ( ! event.allow ) {
                return res.status(403).send('Forbidden');
            }

            next();
        });
    }

    if ( globalMW.json ) {
        const rawBodyBuffer = (req, _res, buf, encoding) => {
            req.rawBody = buf.toString(encoding || 'utf8');
        };

        mw.push(express.json({ limit: '50mb', verify: rawBodyBuffer }));
        mw.push((req, res, next) => {
            if ( req.headers['content-type']?.startsWith('application/json')
                && req.body
                && Buffer.isBuffer(req.body)
            ) {
                try {
                    req.rawBody = req.body;
                    req.body = JSON.parse(req.body.toString('utf8'));
                } catch {
                    return res.status(400).send({
                        error: {
                            message: 'Invalid JSON body',
                        },
                    });
                }
            }
            next();
        });
    }

    if ( globalMW.cookieParser ) {
        const cookieParser = require('cookie-parser');
        mw.push(cookieParser({ limit: '50mb' }));
    }

    if ( globalMW.compression ) {
        const compression = require('compression');
        mw.push(compression());
    }

    if ( globalMW.helmet ) {
        const helmet = require('helmet');
        mw.push(helmet.noSniff());
        mw.push(helmet.hsts());
        mw.push(helmet.ieNoOpen());
        mw.push(helmet.permittedCrossDomainPolicies());
        mw.push(helmet.xssFilter());
        mw.push((_req, res, next) => {
            res.removeHeader('X-Powered-By');
            next();
        });
    }

    if ( globalMW.uaParser ) {
        const uaParser = require('ua-parser-js');
        mw.push((req, _res, next) => {
            const ua_header = req.headers['user-agent'];
            req.ua = uaParser(ua_header);
            next();
        });

        mw.push((req, _res, next) => {
            req.co_isolation_enabled =
                ['Chrome', 'Edge'].includes(req.ua.browser.name)
                && (Number(req.ua.browser.major) >= 110);
            next();
        });
    }

    if ( globalMW.accessControlParser ) {
        accessControlParserMW = (req, res, next) => {
            const origin = req.headers.origin;

            const is_site =
                req.hostname.endsWith(config.static_hosting_domain) ||
                (config.static_hosting_domain_alt && req.hostname.endsWith(config.static_hosting_domain_alt));
            req.hostname === 'docs.puter.com'
            ;
            const is_popup = !!req.query.embedded_in_popup;
            const is_parent_co = !!req.query.cross_origin_isolated;
            const is_app = !!req.query['puter.app_instance_id'];

            const co_isolation_okay =
                (!is_popup || is_parent_co) &&
                (is_app || !is_site) &&
                req.co_isolation_enabled
                ;

            if (
                req.path === '/signup' ||
                req.path === '/login' ||
                req.path.startsWith('/extensions/') ||
                req.path.startsWith('/auth/oidc')
            ) {
                res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
            }
            if (
                config.experimental_no_subdomain ||
                req.subdomains[req.subdomains.length - 1] === 'api' ||
                req.subdomains[req.subdomains.length - 1] === 'dav'
            ) {
                res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
            }

            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK');

            const allowed_headers = [
                'Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization', 'sentry-trace', 'baggage',
                'Depth', 'Destination', 'Overwrite', 'If', 'Lock-Token', 'DAV', 'stripe-signature',
            ];
            res.header('Access-Control-Allow-Headers', allowed_headers.join(', '));

            if ( config.cross_origin_isolation && co_isolation_okay ) {
                res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
                res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
            }
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

            if ( req.hostname === config.domain ) {
                res.setHeader('X-Frame-Options', 'SAMEORIGIN');
            }

            next();
        };
        mw.push(accessControlParserMW);
    }

    // These flags enable specific middleware.
    if ( settings.abuse ) mw.push(require('../../../middleware/abuse')(settings.abuse));
    if ( settings.verified ) mw.push(require('../../../middleware/verified'));

    // if json explicitly set false, don't use it
    if ( settings.json !== false ) {
        if ( settings.json ) mw.push(express.json(_defaultJsonOptions));
        // A hack so plain text is parsed as JSON in methods which need to be lower latency/avoid the cors roundtrip
        if ( settings.noReallyItsJson ) mw.push(express.json({ ..._defaultJsonOptions, type: '*/*' }));

        mw.push(express.json({
            ..._defaultJsonOptions,
            type: (req) => req.headers['content-type'] === 'text/plain;actually=json',
        }));
    }

    if ( settings.auth ) mw.push(require('../../../middleware/auth'));
    if ( settings.auth2 ) mw.push(require('../../../middleware/auth2'));

    // The `files` setting is an array of strings. Each string is the name
    // of a multipart field that contains files. `multer` is used to parse
    // the multipart request and store the files in `req.files`.
    if ( settings.files ) {
        for ( const key of settings.files ) {
            mw.push(multer().array(key));
        }
    }

    if ( settings.multest ) {
        mw.push(multest());
    }

    // The `multipart_jsons` setting is an array of strings. Each string
    // is the name of a multipart field that contains JSON. This middleware
    // parses the JSON in each field and stores the result in `req.body`.
    if ( settings.multipart_jsons ) {
        for ( const key of settings.multipart_jsons ) {
            mw.push((req, res, next) => {
                try {
                    if ( ! Array.isArray(req.body[key]) ) {
                        req.body[key] = [JSON.parse(req.body[key])];
                    } else {
                        req.body[key] = req.body[key].map(JSON.parse);
                    }
                } catch ( _e ) {
                    return res.status(400).send({
                        error: {
                            message: `Invalid JSON in multipart field ${key}`,
                        },
                    });
                }
                next();
            });
        }
    }

    // The `alias` setting is an object. Each key is the name of a
    // parameter. Each value is the name of a parameter that should
    // be aliased to the key.
    if ( settings.alias ) {
        for ( const alias in settings.alias ) {
            const target = settings.alias[alias];
            mw.push((req, res, next) => {
                const values = req.method === 'GET' ? req.query : req.body;
                if ( values[alias] ) {
                    values[target] = values[alias];
                }
                next();
            });
        }
    }

    // The `parameters` setting is an object. Each key is the name of a
    // parameter. Each value is a `Param` object. The `Param` object
    // specifies how to validate the parameter.
    if ( settings.parameters ) {
        for ( const key in settings.parameters ) {
            const param = settings.parameters[key];
            mw.push(async (req, res, next) => {
                if ( ! req.values ) req.values = {};

                const values = req.method === 'GET' ? req.query : req.body;
                const getParam = (key) => values[key];
                try {
                    const result = await param.consolidate({ req, getParam });
                    req.values[key] = result;
                } catch (e) {
                    api_error_handler(e, req, res, next);
                    return;
                }
                next();
            });
        }
    }

    // what if I wanted to pass arguments to, for example, `json`?
    if ( settings.customArgs ) mw.push(settings.customArgs);

    if ( settings.alarm_timeout ) {
        mw.push((req, res, next) => {
            setTimeout(() => {
                if ( ! res.headersSent ) {
                    const log = req.services.get('log-service').create('eggspress:timeout');
                    const errors = req.services.get('error-service').create(log);
                    let id = Array.isArray(route) ? route[0] : route;
                    id = id.replace(/\//g, '_');
                    errors.report(id, {
                        source: new Error('Response timed out.'),
                        message: 'Response timed out.',
                        trace: true,
                        alarm: true,
                    });
                }
            }, settings.alarm_timeout);
            next();
        });
    }

    if ( settings.response_timeout ) {
        mw.push((req, res, next) => {
            setTimeout(() => {
                if ( ! res.headersSent ) {
                    api_error_handler(APIError.create('response_timeout'), req, res, next);
                }
            }, settings.response_timeout);
            next();
        });
    }

    if ( settings.mw ) {
        mw.push(...settings.mw);
    }

    const errorHandledHandler = async function (req, res, next) {
        if ( settings.subdomain ) {
            if ( subdomain(req) !== settings.subdomain ) {
                return next();
            }
        }
        if ( config.env === 'dev' && process.env.DEBUG ) {
            console.log(`request url: ${req.url}, body: ${JSON.stringify(req.body)}`);
        }
        try {
            const expected_ctx = res.locals.ctx;
            const received_ctx = Context.get(undefined, { allow_fallback: true });

            if ( expected_ctx != received_ctx ) {
                await expected_ctx.arun(async () => {
                    await handler(req, res, next);
                });
            } else await handler(req, res, next);
        } catch (e) {
            if ( config.env === 'dev' ) {
                if ( ! (e instanceof APIError) ) {
                    // Any non-APIError indicates an unhandled error (i.e. a bug) from the backend.
                    // We add a dedicated branch to facilitate debugging.
                    console.error(e);
                }
            }
            api_error_handler(e, req, res, next);
        }
    };

    if ( settings.allowedMethods.includes('GET') ) {
        router.get(route, ...mw, errorHandledHandler, ...afterMW);
    }

    if ( settings.allowedMethods.includes('HEAD') ) {
        router.head(route, ...mw, errorHandledHandler, ...afterMW);
    }

    if ( settings.allowedMethods.includes('POST') ) {
        router.post(route, ...mw, errorHandledHandler, ...afterMW);
    }

    if ( settings.allowedMethods.includes('PUT') ) {
        router.put(route, ...mw, errorHandledHandler, ...afterMW);
    }

    if ( settings.allowedMethods.includes('DELETE') ) {
        router.delete(route, ...mw, errorHandledHandler, ...afterMW);
    }

    if ( settings.allowedMethods.includes('PROPFIND') ) {
        router.propfind(route, ...mw, errorHandledHandler, ...afterMW);
    }

    if ( settings.allowedMethods.includes('PROPPATCH') ) {
        router.proppatch(route, ...mw, errorHandledHandler, ...afterMW);
    }

    if ( settings.allowedMethods.includes('MKCOL') ) {
        router.mkcol(route, ...mw, errorHandledHandler, ...afterMW);
    }

    if ( settings.allowedMethods.includes('COPY') ) {
        router.copy(route, ...mw, errorHandledHandler, ...afterMW);
    }

    if ( settings.allowedMethods.includes('MOVE') ) {
        router.move(route, ...mw, errorHandledHandler, ...afterMW);
    }

    if ( settings.allowedMethods.includes('LOCK') ) {
        router.lock(route, ...mw, errorHandledHandler, ...afterMW);
    }

    if ( settings.allowedMethods.includes('UNLOCK') ) {
        router.unlock(route, ...mw, errorHandledHandler, ...afterMW);
    }

    if ( ! settings.allowedMethods.includes('OPTIONS') ) {
        const optionsMW = accessControlParserMW ? [accessControlParserMW] : [];
        router.options(route, ...optionsMW, (_req, res) => {
            return res.sendStatus(200);
        });
    }

    if ( settings.allowedMethods.includes('OPTIONS') ) {
        router.options(route, ...mw, errorHandledHandler, ...afterMW);
    }

    return router;
};
