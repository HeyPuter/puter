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

import { HttpError } from '../../core/http/HttpError.js';
import { PuterController } from '../types.js';

/**
 * System-level endpoints — health, version, contact.
 *
 * These are all low-risk, authenticated or not, and mostly stateless.
 */
/**
 * Liveness polling. The callers here are infrastructure, not people: a load
 * balancer, an orchestrator and any external uptime prober all poll this, and
 * they typically egress from a small set of addresses. A 429 here is read as an
 * unhealthy node and takes the node out of rotation, so the ceiling is set
 * where only a runaway loop can reach it. The handler itself reads a status
 * snapshot refreshed on a background timer, so the per-request cost is close to
 * nil.
 *
 * `memory` rather than the shared default, and that choice is load-bearing:
 *
 * - This route decides whether a node stays in rotation, so it must not depend on
 *   anything it isn't already reporting on. The default backend is redis, and
 *   the cluster is configured with an offline queue and no per-command timeout
 *   — so while redis is unreachable a gated request waits on it rather than
 *   failing fast. The gate does fail open, but only once the call rejects, and
 *   the ALB gives a target 4s per probe and evicts after two. A redis
 *   degradation could therefore empty every target group in every region, which
 *   is the outcome the `@dependencies` degrade rules in the health check query
 *   exist to prevent. Keeping the counter in-process removes redis from the
 *   liveness path entirely.
 * - Per-node counting is also the more honest bucket here. The ceiling only ever
 *   needs to cover the pollers hitting _this_ node, not (pollers x fleet size)
 *   as a shared counter does.
 */
const HEALTHCHECK_LIMIT = {
    scope: 'healthcheck',
    limit: 30_000,
    window: 60_000,
    key: 'ip',
    backend: 'memory',
};

/**
 * Deploy-constant build info, polled by clients. One address is a NAT, a
 * campus, a proxy or a server-side renderer, so this bucket aggregates every
 * client behind it — sizing it for a single browser would throttle a whole
 * office. The response is cached per-client for a minute, which bounds each
 * client to roughly one hit per window; the ceiling is what is left to catch a
 * client that ignores the cache.
 */
const VERSION_LIMIT = {
    scope: 'version',
    limit: 6_000,
    window: 60_000,
    key: 'ip',
};

/**
 * Deploy-constant deployment identity, read once per page load to decide
 * whether to offer signup. Same aggregation as `/version` — the bucket is a
 * whole network's worth of clients — and the payload is four constants, so the
 * limit only guards against an unbounded client loop.
 */
const WHOAREWE_LIMIT = {
    scope: 'whoarewe',
    limit: 6_000,
    window: 60_000,
    key: 'ip',
};

/** Static introspection output, read once at boot rather than in a loop. */
const LSMOD_LIMIT = {
    scope: 'lsmod',
    limit: 60,
    window: 60_000,
    key: 'user',
};

export class SystemController extends PuterController {
    constructor(config, clients, stores, services, drivers) {
        super(config, clients, stores, services, drivers);
        this.bootTime = Date.now();
    }

    registerRoutes(
        /** @type {import('../../core/http/PuterRouter.js').PuterRouter} */
        router,
    ) {
        // -- Healthcheck ---------------------------------------------
        // Delegates to ServerHealthService for the real check-based
        // status. Returns `{ ok: true }` + 200 when all registered checks
        // pass, or `{ ok: false, failed: [...] }` + 503 when any fail or the
        // server is draining.
        //
        // `?ignore=a,b` disregards the named checks for this request only.
        // `?marked-degraded=a,b` demotes the named checks to a non-fatal
        // `degraded` list: `ok` stays true but the response is 207 so the
        // caller can tell the node is running in a degraded state. Either list
        // accepts `@<group>` to stand for every check in a group — notably
        // `@dependencies` for the backing-service probes — so a caller polling
        // this route doesn't have to enumerate them.
        const parseNames = (value) =>
            typeof value === 'string'
                ? value
                      .split(',')
                      .map((name) => name.trim())
                      .filter(Boolean)
                : [];
        router.get(
            '/healthcheck',
            { subdomain: '*', rateLimit: HEALTHCHECK_LIMIT },
            async (req, res) => {
                const health = this.services.health;
                if (!health || typeof health.getStatus !== 'function') {
                    // Fallback for boot ordering / missing service.
                    return res.send('ok');
                }
                const status = await health.getStatus({
                    ignore: parseNames(req.query.ignore),
                    degrade: parseNames(req.query['marked-degraded']),
                });
                if (!status.ok) return res.status(503).json(status);
                if (status.degraded?.length)
                    return res.status(207).json(status);
                return res.json(status);
            },
        );

        // -- Version -------------------------------------------------

        router.get(
            '/version',
            { subdomain: '*', rateLimit: VERSION_LIMIT },
            (_req, res) => {
                const version =
                    this.config.version ??
                    process.env.npm_package_version ??
                    'unknown';
                const parts = String(version).split('.');
                // Deploy-constant, and callers poll it. Cache per-client only:
                // a shared cache could pin one region's `location` for everyone,
                // and the short window still bounds how long a client can miss a
                // new deploy.
                res.setHeader('Cache-Control', 'private, max-age=60');
                res.json({
                    version,
                    major: parts[0] ? Number(parts[0]) : null,
                    minor: parts[1] ? Number(parts[1]) : null,
                    patch: parts[2] ? Number(parts[2]) : null,
                    environment: this.config.env ?? 'prod',
                    location: this.config.serverId ?? null,
                    deploy_timestamp: this.bootTime,
                });
            },
        );

        // -- Contact us ----------------------------------------------

        router.post(
            '/contactUs',
            {
                subdomain: 'api',
                requireUserActor: true,
                allowFullAccessToken: true,
                rateLimit: {
                    scope: 'contact-us',
                    limit: 10,
                    window: 15 * 60_000,
                    key: 'user',
                },
            },
            async (req, res) => {
                const { message } = req.body ?? {};
                if (!message || typeof message !== 'string') {
                    throw new HttpError(400, '`message` is required', {
                        legacyCode: 'bad_request',
                    });
                }
                if (message.length > 100_000) {
                    throw new HttpError(
                        400,
                        '`message` is too long (max 100,000 characters)',
                        { legacyCode: 'bad_request' },
                    );
                }

                // Persist to feedback table for durability
                try {
                    await this.clients.db.write(
                        'INSERT INTO `feedback` (`user_id`, `message`) VALUES (?, ?)',
                        [req.actor.user.id, message],
                    );
                } catch (e) {
                    console.warn('[contactUs] feedback insert failed:', e);
                }

                // Send to support email
                const supportEmail =
                    this.config.support_email ?? 'support@puter.com';
                if (this.clients.email && req.actor.user?.email) {
                    try {
                        await this.clients.email.sendRaw({
                            to: supportEmail,
                            replyTo: req.actor.user.email,
                            subject: `Contact from ${req.actor.user.username}`,
                            text: message,
                        });
                    } catch (e) {
                        console.warn('[contactUs] email send failed:', e);
                    }
                }

                res.json({});
            },
        );

        // -- GET /whoarewe -------------------------------------------

        router.get('/whoarewe', { rateLimit: WHOAREWE_LIMIT }, (_req, res) => {
            res.json({
                name: 'Puter',
                version: this.config.version ?? null,
                environment: this.config.env ?? 'prod',
                disable_user_signup: Boolean(this.config.disable_user_signup),
            });
        });

        // -- GET|POST /lsmod -----------------------------------------
        // Enumerates driver interfaces and their implementors. POST is
        // also routed because puter.js `drivers.list()` sends POST.

        const lsmod = (_req, res) => {
            const interfaces = {};
            for (const [key, driver] of Object.entries(this.drivers)) {
                const ifaceName = driver?.driverInterface;
                if (!ifaceName) continue;
                const driverName = driver.driverName ?? key;
                if (!interfaces[ifaceName]) {
                    interfaces[ifaceName] = { implementors: {} };
                }
                interfaces[ifaceName].implementors[driverName] = {
                    isDefault: Boolean(driver.isDefault),
                };
            }
            res.json({ interfaces });
        };
        router.get(
            '/lsmod',
            { subdomain: 'api', requireAuth: true, rateLimit: LSMOD_LIMIT },
            lsmod,
        );
        router.post(
            '/lsmod',
            { subdomain: 'api', requireAuth: true, rateLimit: LSMOD_LIMIT },
            lsmod,
        );
    }

    onServerStart() {}
    onServerPrepareShutdown() {
        globalThis.__puter_draining = true;
    }
    onServerShutdown() {}
}
