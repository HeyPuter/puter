/* eslint-disable @typescript-eslint/no-explicit-any */
import compression from 'compression';
import cookieParser from 'cookie-parser';
import express from 'express';
import type { Application, RequestHandler } from 'express';
import helmet from 'helmet';
import uaParser from 'ua-parser-js';
import { readdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { puterClients } from './clients';
import { puterControllers } from './controllers';
import { createAuthProbe } from './core/http/middleware/authProbe';
import { createRequestContextMiddleware } from './core/http/middleware/requestContext';
import { createErrorHandler } from './core/http/middleware/errorHandler';
import {
    adminOnlyGate,
    allowedAppIdsGate,
    requireAuthGate,
    requireUserActorGate,
    subdomainGate,
} from './core/http/middleware/gates';
import { createNotFoundHandler } from './core/http/middleware/notFoundHandler';
import { requireAntiCsrf } from './core/http/middleware/antiCsrf';
import { captchaGate } from './core/http/middleware/captcha';
import { rateLimitGate } from './core/http/middleware/rateLimit';
import { createWwwRedirect, createUserSubdomainRedirect, createNativeAppStatic } from './core/http/middleware/hostRedirects';
import { PuterRouter } from './core/http/PuterRouter';
import { PREFIX_METADATA_KEY, type RouteDescriptor } from './core/http/types';
import type { AuthService } from './services/auth/AuthService';
import { puterDrivers } from './drivers';
import { clientsContainers, configContainer, controllersContainers, driversContainers, servicesContainers, storesContainers } from './exports';
import { extensionStore } from './extensions';
import { puterServices } from './services';
import { puterStores } from './stores';
import type { IConfig, LayerInstances, WithControllerRegistration, WithLifecycle } from './types';

export class PuterServer {

    clients!: LayerInstances<typeof puterClients>;
    stores!: LayerInstances<typeof puterStores>;
    services!: LayerInstances<typeof puterServices>;
    controllers!: LayerInstances<typeof puterControllers>;
    drivers!: LayerInstances<typeof puterDrivers>;
    #config: IConfig;
    #app!: ReturnType<typeof express>;
    #server: ReturnType<ReturnType<typeof express>['listen']> | null = null;

    #ready: Promise<boolean>;

    constructor (config: IConfig, clients: typeof puterClients, stores: typeof puterStores, services: typeof puterServices, controllers: typeof puterControllers, drivers: typeof puterDrivers) {

        this.#config = config;
        // Expose config to the extension API (extension.config)
        Object.assign(configContainer, config);
        this.#ready = this.#setupServer(clients, stores, services, controllers, drivers);
    }

    async #setupServer (clients: typeof puterClients, stores: typeof puterStores, services: typeof puterServices, controllers: typeof puterControllers, drivers: typeof puterDrivers) {

        // Load prod extensions from configured directories (dynamic)
        const extensionDirs = this.#config.extensions;
        await this.#importExtensions(extensionDirs);

        this.clients = {} as typeof this.clients;
        for ( const [clientName, ClientClass] of Object.entries(clients) ) {
            this.clients[clientName] = (typeof ClientClass === 'object' ? ClientClass : (new (ClientClass as any)(this.#config)) as any);
            clientsContainers[clientName] = this.clients[clientName];
        }
        for ( const [clientName, ClientClass] of Object.entries(extensionStore.clients) ) {
            this.clients[clientName] = (typeof ClientClass === 'object' ? ClientClass : (new (ClientClass as any)(this.#config)) as any);
            clientsContainers[clientName] = this.clients[clientName];
        }

        this.stores = {} as typeof this.stores;
        for ( const [storeName, StoreClass] of Object.entries(stores) ) {
            this.stores[storeName] = (typeof StoreClass === 'object' ? StoreClass : (new (StoreClass as any)(this.#config, this.clients, this.stores)) as any);
            storesContainers[storeName] = this.stores[storeName];
        }
        for ( const [storeName, StoreClass] of Object.entries(extensionStore.stores) ) {
            this.stores[storeName] = (typeof StoreClass === 'object' ? StoreClass : (new (StoreClass as any)(this.#config, this.clients, this.stores)) as any);
            storesContainers[storeName] = this.stores[storeName];
        }

        this.services = {} as typeof this.services;
        for ( const [serviceName, ServiceClass] of Object.entries(services) ) {
            this.services[serviceName] = (typeof ServiceClass === 'object' ? ServiceClass : (new (ServiceClass as any)(this.#config, this.clients, this.stores, this.services)) as any);
            servicesContainers[serviceName] = this.services[serviceName];
        }
        for ( const [serviceName, ServiceClass] of Object.entries(extensionStore.services) ) {
            this.services[serviceName] = (typeof ServiceClass === 'object' ? ServiceClass : (new (ServiceClass as any)(this.#config, this.clients, this.stores, this.services)) as any);
            servicesContainers[serviceName] = this.services[serviceName];
        }

        // init express server here
        this.#app = express();
        this.#installGlobalMiddleware();

        // Instantiate drivers BEFORE controllers so controllers can receive
        // a typed `drivers` reference. The `/drivers/*` HTTP surface lives
        // on `DriverController` (a regular controller) which reads from
        // `this.drivers` — no separate registry object here any more.
        this.drivers = {} as typeof this.drivers;
        const allDriverSources = [
            ...Object.entries(drivers),
            ...Object.entries(extensionStore.drivers),
        ];
        for ( const [driverKey, DriverClass] of allDriverSources ) {
            const instance = (typeof DriverClass === 'object'
                ? DriverClass
                : (new (DriverClass as any)(this.#config, this.clients, this.stores, this.services)) as any);
            this.drivers[driverKey] = instance;
            driversContainers[driverKey] = instance;
        }

        this.controllers = {} as typeof this.controllers;
        for ( const [controllerName, ControllerClass] of Object.entries(controllers) ) {
            this.controllers[controllerName] = (typeof ControllerClass === 'object'
                ? ControllerClass
                : (new (ControllerClass as any)(this.#config, this.clients, this.stores, this.services, this.drivers)) as any);
            this.#registerControllerRoutes(controllerName, this.controllers[controllerName]);
            controllersContainers[controllerName] = this.controllers[controllerName];
        }
        for ( const [controllerName, ControllerClass] of Object.entries(extensionStore.controllers) ) {
            this.controllers[controllerName] = (typeof ControllerClass === 'object'
                ? ControllerClass
                : (new (ControllerClass as any)(this.#config, this.clients, this.stores, this.services, this.drivers)) as any);
            this.#registerControllerRoutes(controllerName, this.controllers[controllerName]);
            controllersContainers[controllerName] = this.controllers[controllerName];
        }

        // Register extension event listeners. Extensions opted for a
        // 2-arg `(data, meta)` handler shape; EventClient calls with
        // `(key, data, meta)`. Drop `key` in the adapter so extension
        // code stays stable.
        Object.entries(extensionStore.events).forEach(([event, handlers]) => {
            handlers.forEach(handler => {
                this.clients.event.on(event, (_key: string, data: unknown, meta: object) => handler(data, meta));
            });
        });

        // Extension routes are shaped as `RouteDescriptor`s too, so they
        // flow through the same materializer as controller routes — same
        // option → middleware translation (subdomain, auth, body parsers, …).
        // The extension-layer "prefix" is always empty; extensions compose
        // their own path strings.
        for ( const route of extensionStore.routeHandlers ) {
            this.#materializeRoute(this.#app, '', route);
        }

        // Terminal middleware MUST install last — after every route + extension
        // route is registered, so the catch-all 404 only fires for genuinely
        // unmatched requests, and the error handler is reachable from any
        // thrown error in the stack above it.
        this.#installTerminalMiddleware();

        return true;
    }

    /**
     * Install always-on middleware on the express app, in the order they
     * must run at request time. Ordering note:
     *   - `express.json` must run before `authProbe` so `req.body.auth_token`
     *     is readable.
     *   - `authProbe` never rejects; it only populates `req.actor` if a valid
     *     token is present.
     *   - Per-route gate middleware (requireAuth, adminOnly, ...) lands in
     *     `#materializeRoute` as those options ship.
     */
    #installGlobalMiddleware () {
        // ── Cookie parsing ──────────────────────────────────────────
        this.#app.use(cookieParser());

        // ── Compression ─────────────────────────────────────────────
        this.#app.use(compression());

        // ── Security headers (helmet) ───────────────────────────────
        this.#app.use(helmet.noSniff());
        this.#app.use(helmet.hsts());
        this.#app.use(helmet.ieNoOpen());
        this.#app.use(helmet.permittedCrossDomainPolicies());
        this.#app.use(helmet.xssFilter());
        this.#app.disable('x-powered-by');

        // Cross-Origin-Resource-Policy: always allow cross-origin reads.
        // The stricter COOP+COEP pair (for SharedArrayBuffer) is deferred
        // until the hosting layer lands — it requires UA + context gating.
        this.#app.use((_req, res, next) => {
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
            next();
        });

        // ── Query param sanitization ────────────────────────────────
        // Strip non-primitive query values. Express 5's default simple
        // parser mostly avoids these, but when `extended` qs is enabled
        // (or a client tricks the parser) arrays/objects can sneak in.
        this.#app.use((req, _res, next) => {
            if ( req.query ) {
                const allowed = ['string', 'number', 'boolean'];
                for ( const k of Object.keys(req.query) ) {
                    const v = req.query[k];
                    if ( v != null && !allowed.includes(typeof v) ) {
                        delete req.query[k];
                    }
                }
            }
            next();
        });

        // ── UA parsing ──────────────────────────────────────────────
        this.#app.use((req, _res, next) => {
            const header = req.headers['user-agent'];
            if ( header ) {
                req.ua = uaParser(header);
            }
            next();
        });

        // ── Host header validation ──────────────────────────────────
        this.#installHostValidation();

        // ── Host redirects (www → root, user subdomain → static hosting)
        // Installed after host validation so we know the host is allowed,
        // and before CORS/body-parsing so we short-circuit on redirects
        // without burning work.
        this.#app.use(createWwwRedirect(this.#config));
        this.#app.use(createUserSubdomainRedirect(this.#config));

        // ── Native app static serving (editor.*, docs.*, …) ─────────
        // No-op when `native_apps_root` is unset.
        this.#app.use(createNativeAppStatic(this.#config));

        // ── CORS headers ────────────────────────────────────────────
        this.#installCors();

        // ── IP validation ───────────────────────────────────────────
        if ( this.#config.enable_ip_validation ) {
            this.#installIpValidation();
        }

        // ── OPTIONS preflight ───────────────────────────────────────
        this.#app.options('/*splat', (_req, res) => {
            res.sendStatus(200);
        });

        // ── Body parsing (JSON + text-as-json shim) ─────────────────
        const captureRawBody: NonNullable<Parameters<typeof express.json>[0]>['verify'] = (req, _res, buf) => {
            (req as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
        };
        this.#app.use(express.json({ limit: '50mb', verify: captureRawBody }));
        this.#app.use(express.json({
            limit: '50mb',
            type: (req) => req.headers['content-type'] === 'text/plain;actually=json',
            verify: captureRawBody,
        }));

        // ── Auth probe ──────────────────────────────────────────────
        const authService = this.services.auth as AuthService | undefined;
        if ( authService ) {
            this.#app.use(createAuthProbe({
                authService,
                cookieName: this.#config.cookie_name,
            }));
        }

        // ── Per-request ALS context ─────────────────────────────────
        // Runs AFTER auth probe so `req.actor` is already populated when
        // we snapshot it into the context.
        this.#app.use(createRequestContextMiddleware());
    }

    // ── Host header validation ──────────────────────────────────────

    #installHostValidation () {
        const config = this.#config;

        // Hostname missing — malformed request from a broken client.
        this.#app.use((req, res, next) => {
            if ( req.hostname === undefined ) {
                res.status(400).send('Please verify your browser is up-to-date.');
                return;
            }
            next();
        });

        // Build the allowed-domain set from config.
        this.#app.use((req, res, next) => {
            if ( config.allow_all_host_values ) {
                next();
                return;
            }

            if ( !config.allow_no_host_header && !req.headers.host ) {
                res.status(400).send('Missing Host header.');
                return;
            }

            // /healthcheck is always reachable regardless of host.
            if ( req.path === '/healthcheck' ) {
                next();
                return;
            }

            const hostName = (req.headers.host ?? '').split(':')[0].trim().toLowerCase();
            const allowed = this.#getAllowedDomains();

            if ( allowed.some(d => PuterServer.#hostMatchesDomain(hostName, d)) ) {
                next();
                return;
            }

            if ( config.custom_domains_enabled ) {
                req.is_custom_domain = true;
                next();
                return;
            }

            res.status(400).send('Invalid Host header.');
        });
    }

    #allowedDomainsCache: string[] | null = null;

    #getAllowedDomains (): string[] {
        if ( this.#allowedDomainsCache ) return this.#allowedDomainsCache;
        const cfg = this.#config;
        const raw = [
            cfg.domain,
            cfg.static_hosting_domain,
            cfg.static_hosting_domain_alt,
            cfg.private_app_hosting_domain,
            cfg.private_app_hosting_domain_alt,
        ];
        const staticDomain = PuterServer.#normalizeDomain(cfg.static_hosting_domain);
        if ( staticDomain ) raw.push(`at.${staticDomain}`);
        if ( cfg.allow_nipio_domains ) raw.push('nip.io');

        this.#allowedDomainsCache = raw
            .map(PuterServer.#normalizeDomain)
            .filter((d): d is string => d !== null);
        return this.#allowedDomainsCache;
    }

    static #normalizeDomain (d: string | undefined | null): string | null {
        if ( !d || typeof d !== 'string' ) return null;
        const trimmed = d.trim().toLowerCase();
        return trimmed.length > 0 ? trimmed : null;
    }

    static #hostMatchesDomain (hostname: string, domain: string): boolean {
        return hostname === domain || hostname.endsWith(`.${domain}`);
    }

    // ── CORS headers ─────────────────────────────────────────────────

    #installCors () {
        const config = this.#config;
        const allowedMethods = 'GET, POST, OPTIONS, PUT, PATCH, DELETE, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK';
        const allowedHeaders = [
            'Origin', 'X-Requested-With', 'Content-Type', 'Accept',
            'Authorization', 'sentry-trace', 'baggage',
            'Depth', 'Destination', 'Overwrite', 'If', 'Lock-Token', 'DAV',
            'stripe-signature',
        ].join(', ');

        this.#app.use((req, res, next) => {
            const origin = req.headers.origin;
            const subdomain = req.subdomains?.[req.subdomains.length - 1];
            const isApiOrDav = subdomain === 'api' || subdomain === 'dav';
            const isCrossOriginAuthRoute =
                req.path === '/signup'
                || req.path === '/login'
                || req.path.startsWith('/extensions/')
                || req.path.startsWith('/auth/oidc');

            // Allow-Origin for API/DAV + auth routes
            if ( isCrossOriginAuthRoute || isApiOrDav ) {
                res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
                if ( origin ) res.vary('Origin');
            }

            // Credentials on API/DAV cross-origin
            if ( isApiOrDav && origin ) {
                res.setHeader('Access-Control-Allow-Credentials', 'true');
            }

            res.setHeader('Access-Control-Allow-Methods', allowedMethods);
            res.setHeader('Access-Control-Allow-Headers', allowedHeaders);

            // Disable iframes on the main domain
            if ( req.hostname === config.domain ) {
                res.setHeader('X-Frame-Options', 'SAMEORIGIN');
            }

            next();
        });
    }

    // ── IP validation ───────────────────────────────────────────────

    #installIpValidation () {
        this.#app.use(async (req, res, next) => {
            const ip = req.headers?.['x-forwarded-for'] ?? req.socket?.remoteAddress;
            const event = { allow: true, ip };
            this.clients.event.emit('ip.validate', event, {});
            if ( ! event.allow ) {
                res.status(403).send('Forbidden');
                return;
            }
            next();
        });
    }

    /**
     * Install end-of-pipeline middleware. Order matters:
     *   1. The 404 catch-all runs only when no earlier route matched, so it
     *      must be installed *after* every controller + extension route.
     *   2. The error handler is the express terminal — it catches everything
     *      thrown by routes, gates, and the 404 above. Express 5 auto-forwards
     *      thrown errors (sync and async), so handlers can `throw new HttpError(...)`
     *      without `next(err)` ceremony.
     */
    #installTerminalMiddleware () {
        this.#app.use(createNotFoundHandler());
        this.#app.use(createErrorHandler());
    }

    /**
     * Walk a controller's declared routes (via `PuterRouter`) and register
     * each one against the underlying express app. Per-route option → middleware
     * translation lives here — when we add auth/subdomain/body-parsing
     * options, they get wired in at this single point without touching any
     * controller call site.
     */
    #registerControllerRoutes (controllerName: string, controller: WithControllerRegistration) {
        if ( ! controller.registerRoutes ) {
            throw new Error(`Controller ${controllerName} does not have registerRoutes method`);
        }

        // Controllers annotated with `@Controller('/prefix')` carry the prefix
        // on their prototype; bare (imperative) controllers default to ''.
        const prefix = (controller as unknown as Record<string, unknown>)[PREFIX_METADATA_KEY] as string | undefined;
        const router = new PuterRouter(prefix ?? '');
        controller.registerRoutes(router);

        for ( const route of router.routes ) {
            this.#materializeRoute(this.#app, router.prefix, route);
        }
    }

    #materializeRoute (app: Application, routerPrefix: string, route: RouteDescriptor) {
        const mwChain: RequestHandler[] = [];
        const opts = route.options;

        // 1. Subdomain routing. Routes that specify `subdomain` only match
        // that subdomain(s). Routes WITHOUT a `subdomain` option (and that
        // aren't `use` middleware) are restricted to the root origin — this
        // prevents API-subdomain requests from accidentally hitting a root-
        // only route. Explicit `subdomain: '*'` disables the gate entirely.
        if ( opts.subdomain !== undefined ) {
            if ( opts.subdomain !== '*' ) {
                mwChain.push(subdomainGate(opts.subdomain));
            }
            // subdomain: '*' → no gate, match any subdomain
        } else if ( route.method !== 'use' ) {
            // No subdomain specified + not a `use()` middleware → root only.
            // Root = no subdomain present (req.subdomains is empty).
            mwChain.push((req, _res, next) => {
                if ( req.subdomains && req.subdomains.length > 0 ) {
                    next('route');
                    return;
                }
                next();
            });
        }

        // 2. Auth gates. Implication graph:
        //   adminOnly        => requireUserActor => requireAuth
        //   allowedAppIds    => requireAuth
        //   requireUserActor => requireAuth
        // Dedupe: only push requireAuthGate once when *any* of these are set.
        const needsAuth = Boolean(
            opts.requireAuth
            || opts.requireUserActor
            || opts.adminOnly
            || opts.allowedAppIds,
        );
        if ( needsAuth ) mwChain.push(requireAuthGate());

        const needsUserActor = Boolean(opts.requireUserActor || opts.adminOnly);
        if ( needsUserActor ) mwChain.push(requireUserActorGate());

        if ( opts.adminOnly ) {
            const extras = Array.isArray(opts.adminOnly) ? opts.adminOnly : [];
            mwChain.push(adminOnlyGate(extras));
        }

        if ( opts.allowedAppIds ) {
            mwChain.push(allowedAppIdsGate(opts.allowedAppIds));
        }

        // 2b. Rate limiting. Runs after auth so 'user' key strategy
        // has access to req.actor.
        if ( opts.rateLimit ) {
            mwChain.push(rateLimitGate(opts.rateLimit) as unknown as RequestHandler);
        }

        // 2c. Captcha verification. Reads captchaToken + captchaAnswer
        // from req.body — body is already parsed by the global JSON
        // middleware at this point.
        if ( opts.captcha ) {
            const enabled = Boolean(this.#config.captcha?.enabled);
            mwChain.push(captchaGate(enabled) as unknown as RequestHandler);
        }

        // 2d. Anti-CSRF token consumption.
        if ( opts.antiCsrf ) {
            mwChain.push(requireAntiCsrf() as unknown as RequestHandler);
        }

        // 3. Per-route body parsers. Each is a no-op when the request's
        // content-type doesn't match — multiple can coexist. The global
        // `application/json` parser already ran in `#installGlobalMiddleware`,
        // so by default the only reason to opt into one of these is to handle
        // a non-JSON body shape (raw bytes, plain text, urlencoded form) or
        // to override JSON limits on a hot path.
        // bodyJson is `false | { limit?, type? }`. Truthiness check excludes
        // both `undefined` (no opt) and `false` (explicit opt-out).
        if ( opts.bodyJson ) {
            mwChain.push(express.json({
                limit: opts.bodyJson.limit,
                type: opts.bodyJson.type,
            }));
        }

        if ( opts.bodyRaw ) {
            const raw = opts.bodyRaw === true ? {} : opts.bodyRaw;
            mwChain.push(express.raw({
                limit: raw.limit,
                type: raw.type,
            }));
        }

        if ( opts.bodyText ) {
            const text = opts.bodyText === true ? {} : opts.bodyText;
            mwChain.push(express.text({
                limit: text.limit,
                type: text.type,
            }));
        }

        if ( opts.bodyUrlencoded ) {
            const ue = opts.bodyUrlencoded === true ? {} : opts.bodyUrlencoded;
            mwChain.push(express.urlencoded({
                limit: ue.limit,
                extended: ue.extended ?? true,
            }));
        }

        // 4. Caller-supplied middleware runs after gates + parsers, before the handler.
        if ( opts.middleware ) mwChain.push(...opts.middleware);

        const fullPath = route.path !== undefined
            ? PuterServer.#joinPath(routerPrefix, route.path)
            : undefined;

        if ( route.method === 'use' ) {
            if ( fullPath !== undefined ) {
                app.use(fullPath as any, ...mwChain, route.handler);
            } else {
                app.use(...mwChain, route.handler);
            }
            return;
        }

        if ( fullPath === undefined ) {
            throw new Error(`Route method '${route.method}' requires a path`);
        }

        // All express + WebDAV verbs accept the same (path, ...handlers) shape.
        // The `RouteMethod` union is the allowlist of method names we expose.
        const method = app[route.method as keyof Application] as unknown;
        if ( typeof method !== 'function' ) {
            throw new Error(`Express app does not support method: ${route.method}`);
        }
        (method as (...args: unknown[]) => unknown).call(app, fullPath, ...mwChain, route.handler);
    }

    /**
     * Join a controller's prefix with a route path. RegExp / array paths are
     * passed through unprefixed (consistent with express's behavior and with
     * the v1 extensionController's assumption that decorator paths are strings).
     */
    static #joinPath (prefix: string, path: NonNullable<RouteDescriptor['path']>): string | RegExp | Array<string | RegExp> {
        if ( typeof path !== 'string' ) return path;
        if ( ! prefix ) return path;
        return `${prefix}/${path}`.replace(/\/+/g, '/');
    }

    async #importExtensions (extensionDirs: string[]) {
        for ( const extDir of extensionDirs ) {
            for ( const jsFileOrFolder of readdirSync(extDir) ) {
                // if its a folder, read the package.json to find the main file, otherwise if its a js/ts/mjs file, import it directly
                if ( jsFileOrFolder.endsWith('.js') || jsFileOrFolder.endsWith('.mjs') ) {
                    console.log(`Importing extension file ${extDir}/${jsFileOrFolder}`);
                    await import(`${extDir}/${jsFileOrFolder}`);
                } else if ( ! jsFileOrFolder.includes('.') ) {
                    const packageJson = JSON.parse(readFileSync(`${extDir}/${jsFileOrFolder}/package.json`, 'utf-8'));
                    const mainFile = packageJson.main;
                    console.log(`Importing extension file ${extDir}/${jsFileOrFolder}/${mainFile}`);
                    await import(`${extDir}/${jsFileOrFolder}/${mainFile}`);
                }
            }
        }
    }

    async start () {
        await this.#ready;

        // Create the http server explicitly (instead of `app.listen()`) so we
        // have the server reference BEFORE listen starts — anything that needs
        // to hook into the raw server (socket.io upgrades, WebSockets, …) runs
        // its `attachHttpServer(server)` here, pre-listen.
        const httpServer = http.createServer(this.#app);
        for ( const service of Object.values(this.services) as Array<WithLifecycle & { attachHttpServer?: (s: http.Server) => void | Promise<void> }> ) {
            if ( typeof service.attachHttpServer === 'function' ) {
                await service.attachHttpServer(httpServer);
            }
        }

        this.#server = httpServer.listen(this.#config.port, () => {
            console.log(`PuterServer is listening on port: ${this.#config.port}`);
            for ( const client of Object.values(this.clients) as WithLifecycle[] ) {
                if ( client.onServerStart ) {
                    client.onServerStart();
                }
            }
            for ( const store of Object.values(this.stores) as WithLifecycle[] ) {
                if ( store.onServerStart ) {
                    store.onServerStart();
                }
            }
            for ( const service of Object.values(this.services) as WithLifecycle[] ) {
                if ( service.onServerStart ) {
                    service.onServerStart();
                }
            }
            for ( const controller of Object.values(this.controllers) as WithLifecycle[] ) {
                if ( controller.onServerStart ) {
                    controller.onServerStart();
                }
            }
            for ( const driver of Object.values(this.drivers) as WithLifecycle[] ) {
                if ( driver.onServerStart ) {
                    driver.onServerStart();
                }
            }
        });

    }

    async prepareShutdown () {
        if ( this.#server ) {
            this.#server.close(() => {
                console.log('PuterServer has stopped accepting new connections');
                for ( const client of Object.values(this.clients) as WithLifecycle[] ) {
                    if ( client.onServerPrepareShutdown ) {
                        client.onServerPrepareShutdown();
                    }
                }
                for ( const store of Object.values(this.stores) as WithLifecycle[] ) {
                    if ( store.onServerPrepareShutdown ) {
                        store.onServerPrepareShutdown();
                    }
                }
                for ( const service of Object.values(this.services) as WithLifecycle[] ) {
                    if ( service.onServerPrepareShutdown ) {
                        service.onServerPrepareShutdown();
                    }
                }
                for ( const controller of Object.values(this.controllers) as WithLifecycle[] ) {
                    if ( controller.onServerPrepareShutdown ) {
                        controller.onServerPrepareShutdown();
                    }
                }
                for ( const driver of Object.values(this.drivers) as WithLifecycle[] ) {
                    if ( driver.onServerPrepareShutdown ) {
                        driver.onServerPrepareShutdown();
                    }
                }
            });
        }
    }

    async shutdown () {
        if ( this.#server ) {
            console.log('PuterServer is shutting down');
            this.#server.closeAllConnections();
            for ( const client of Object.values(this.clients) as WithLifecycle[] ) {
                if ( client.onServerShutdown ) {
                    await client.onServerShutdown();
                }
            }
            for ( const store of Object.values(this.stores) as WithLifecycle[] ) {
                if ( store.onServerShutdown ) {
                    await store.onServerShutdown();
                }
            }
            for ( const service of Object.values(this.services) as WithLifecycle[] ) {
                if ( service.onServerShutdown ) {
                    await service.onServerShutdown();
                }
            }
            for ( const controller of Object.values(this.controllers) as WithLifecycle[] ) {
                if ( controller.onServerShutdown ) {
                    await controller.onServerShutdown();
                }
            }
            for ( const driver of Object.values(this.drivers) as WithLifecycle[] ) {
                if ( driver.onServerShutdown ) {
                    await driver.onServerShutdown();
                }
            }
        }
    }
}