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
import {
    MAX_TOTAL_ATTACHMENT_BYTES,
    attachmentMetadata,
    attachmentSummary,
    validateContactAttachments,
} from '../../util/contactAttachments.js';
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

/** Longest message the Contact Us form will carry, in characters. */
const CONTACT_MESSAGE_MAX_LENGTH = 100_000;

/**
 * Ceiling on the whole Contact Us request body: the attachment budget once
 * base64 has inflated it by 4/3, plus the message, plus slack for the JSON
 * envelope and file names. Checked against `Content-Length` so a body that
 * cannot possibly be valid is refused before anything decodes it — the global
 * `express.json` limit is a fleet-wide backstop and far larger than what this
 * route has any business accepting.
 */
const CONTACT_BODY_MAX_BYTES =
    Math.ceil(MAX_TOTAL_ATTACHMENT_BYTES / 3) * 4 +
    CONTACT_MESSAGE_MAX_LENGTH +
    64 * 1024;

/**
 * Contact Us submissions are hand-typed by a person, and each one may now carry
 * megabytes of screenshots and screen recordings.
 *
 * - Per-user is the limit that matters: submissions require an authenticated
 *   actor, and ten in a quarter hour is already far past what reporting a bug
 *   takes.
 * - The per-IP backstop bounds how much a single machine can push through freshly
 *   minted accounts, which the per-user counter alone cannot see. Set well
 *   above what a shared office egress would ever legitimately produce.
 */
const CONTACT_US_LIMITS = [
    {
        scope: 'contact-us',
        limit: 10,
        window: 15 * 60_000,
        key: 'user',
    },
    {
        scope: 'contact-us-ip',
        limit: 40,
        window: 24 * 60 * 60_000,
        key: 'ip',
    },
];

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
                rateLimit: CONTACT_US_LIMITS,
                // Attachments make one request worth megabytes of parsing and
                // outbound mail; a per-user rate limit still lets a client keep
                // several of those in flight at once.
                concurrent: { limit: 2, scope: 'contact-us', key: 'user' },
            },
            async (req, res) => {
                const declaredLength = Number(req.headers?.['content-length']);
                if (
                    Number.isFinite(declaredLength) &&
                    declaredLength > CONTACT_BODY_MAX_BYTES
                ) {
                    throw new HttpError(413, 'Request body is too large', {
                        legacyCode: 'bad_request',
                    });
                }

                const { message, attachments: rawAttachments } = req.body ?? {};
                if (!message || typeof message !== 'string') {
                    throw new HttpError(400, '`message` is required', {
                        legacyCode: 'bad_request',
                    });
                }
                if (message.length > CONTACT_MESSAGE_MAX_LENGTH) {
                    throw new HttpError(
                        400,
                        `\`message\` is too long (max ${CONTACT_MESSAGE_MAX_LENGTH.toLocaleString('en-US')} characters)`,
                        { legacyCode: 'bad_request' },
                    );
                }

                // Type, size and file name are all re-derived from the decoded
                // bytes here — nothing the caller declared about them is used.
                const verdict = validateContactAttachments(rawAttachments);
                if (!verdict.ok) {
                    throw new HttpError(400, verdict.reason, {
                        legacyCode: 'bad_request',
                    });
                }
                const attachments = verdict.attachments;

                // Persist to feedback table for durability. Attachment payloads
                // stay out of the row — the mail carries those; the column is
                // the record that they were sent.
                try {
                    await this.clients.db.write(
                        'INSERT INTO `feedback` (`user_id`, `message`, `attachments`) VALUES (?, ?, ?)',
                        [
                            req.actor.user.id,
                            message,
                            attachments.length
                                ? JSON.stringify(
                                      attachmentMetadata(attachments),
                                  )
                                : null,
                        ],
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
                            text: attachments.length
                                ? `${message}\n\n${attachmentSummary(attachments)}`
                                : message,
                            // `attachment` disposition keeps the mail client
                            // from rendering these inline, and the file names
                            // are the sanitized ones with a re-derived
                            // extension — never what the sender typed.
                            attachments: attachments.map((a) => ({
                                filename: a.filename,
                                content: a.content,
                                contentType: a.contentType,
                                contentDisposition: 'attachment',
                            })),
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
