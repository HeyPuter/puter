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

import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Actor } from '../../core/actor.js';
import { Controller, Delete, Get, Post } from '../../core/http/decorators.js';
import { HttpError } from '../../core/http/HttpError.js';
import { DURABLE_LIST_LIMIT_CAP } from '../../stores/events/DurableSubscriptionStore.js';
import { EVENTS_WORKERS_LIST_LIMIT_CAP } from '../../stores/events/EventHandlerStore.js';
import { KV_HANDLE_LIST_LIMIT_CAP } from '../../stores/events/KvShareHandleStore.js';
import { normalizeLimit } from '../../util/pagination.js';
import { PuterController } from '../types.js';
import { EVENTS_WORKER_PREFIX } from '../../services/events/workerRuntime.js';
import {
    EVENTS_FETCH_LIMIT,
    EVENTS_FETCH_LIMIT_CAP,
    EVENTS_HANDLER_LIST_LIMIT,
    EVENTS_LIST_LIMIT,
    EVENTS_WORKER_LIST_LIMIT,
} from './limits.js';
import {
    EventsWorkerDeployer,
    LocalEventsInvokeTransport,
} from './workerDeploy.js';

/**
 * The durable half of the events surface. Session subscriptions arrive over the
 * socket that holds them and are not routable; these are rows that outlive
 * every connection, so they need somewhere to be created, listed and revoked
 * from without one.
 *
 * Gates are `subdomain: 'api'` (verb routes are root-origin by default) plus
 * `allowAccessToken`, because API tokens are in the scoping matrix and access
 * tokens are refused on authenticated routes otherwise. Deliberately **not**
 * `allowedAppIds`: it does not restrict a route to app actors, and using it as
 * though it did is the mis-gating this surface has to avoid. Scope is decided
 * from `effectiveApp` inside the service, over the index the rows are stored
 * under.
 */
/** What a dispatcher may ask to have deployed: an events script name. */
const EVENTS_SCRIPT_REGEX = new RegExp(`^${EVENTS_WORKER_PREFIX}[a-f0-9]{32}$`);

/** Matches the edge dispatcher's own validation of the app uid it forwards. */
const APP_UID_REGEX = /^app-[A-Za-z0-9_-]{1,64}$/;

@Controller('/events')
export class EventsController extends PuterController {
    /**
     * POST /events/subscribe — register a subscription that outlives the
     * caller.
     */
    @Post('/subscribe', {
        subdomain: 'api',
        requireAuth: true,
        allowAccessToken: true,
    })
    async subscribe(req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        const { sub } = await this.services.events.subscribeDurable(
            actor,
            this.#body(req),
        );
        res.json(sub);
    }

    /** GET /events/subscriptions — what the caller holds, one page at a time. */
    @Get('/subscriptions', {
        subdomain: 'api',
        requireAuth: true,
        allowAccessToken: true,
        rateLimit: EVENTS_LIST_LIMIT,
    })
    async list(req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        const query = (req.query ?? {}) as Record<string, unknown>;

        const page = await this.services.events.listDurable(actor, {
            limit: normalizeLimit(query.limit, { cap: DURABLE_LIST_LIMIT_CAP }),
            cursor: typeof query.cursor === 'string' ? query.cursor : undefined,
            includeTotal: query.includeTotal === 'true',
        });

        res.json({
            items: page.items,
            ...(page.cursor ? { cursor: page.cursor } : {}),
            ...(page.total !== undefined ? { total: page.total } : {}),
        });
    }

    /**
     * GET /events/fetch — what the caller missed, one page at a time.
     *
     * Stateless: no subscription, no stored position, nothing written. The
     * cursor comes back to the caller and goes out again as `after`.
     */
    @Get('/fetch', {
        subdomain: 'api',
        requireAuth: true,
        allowAccessToken: true,
        rateLimit: EVENTS_FETCH_LIMIT,
    })
    async fetch(req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        const query = (req.query ?? {}) as Record<string, unknown>;

        const page = await this.services.events.fetchMissed(actor, {
            subject: typeof query.subject === 'string' ? query.subject : '',
            after: typeof query.after === 'string' ? query.after : undefined,
            limit: normalizeLimit(query.limit, {
                cap: EVENTS_FETCH_LIMIT_CAP,
            }),
        });

        res.json({
            items: page.items,
            ...(page.cursor ? { cursor: page.cursor } : {}),
        });
    }

    /**
     * POST /events/unsubscribe — an id the caller does not hold reads as
     * absent.
     */
    @Post('/unsubscribe', {
        subdomain: 'api',
        requireAuth: true,
        allowAccessToken: true,
    })
    async unsubscribe(req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        await this.services.events.unsubscribeDurable(actor, this.#body(req));
        res.json({});
    }

    // -- Cross-user key-value handles --------------------------------

    /**
     * POST /events/kv-handles — hand another user a watchable region of this
     * account's key-value data.
     *
     * An account session, or an app session holding a `manage:` delegation on
     * the region — the service tells those apart and gates each rather than the
     * route doing it, because `effectiveApp` is where app-ness actually lives.
     * A token an app minted is refused there too: a delegation is the app's to
     * hold, not to pass on. A user's own token still acts for the user.
     */
    @Post('/kv-handles', {
        subdomain: 'api',
        requireAuth: true,
        allowAccessToken: true,
    })
    async mintKvHandle(req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        res.json(
            await this.services.events.mintKvHandle(actor, this.#body(req)),
        );
    }

    /** GET /events/kv-handles — what this account has shared out. */
    @Get('/kv-handles', {
        subdomain: 'api',
        requireAuth: true,
        allowAccessToken: true,
        rateLimit: EVENTS_LIST_LIMIT,
    })
    async listKvHandles(req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        const query = (req.query ?? {}) as Record<string, unknown>;

        const page = await this.services.events.listKvHandles(actor, {
            limit: normalizeLimit(query.limit, {
                cap: KV_HANDLE_LIST_LIMIT_CAP,
            }),
            cursor: typeof query.cursor === 'string' ? query.cursor : undefined,
            includeTotal: query.includeTotal === 'true',
        });

        res.json({
            items: page.items,
            ...(page.cursor ? { cursor: page.cursor } : {}),
            ...(page.total !== undefined ? { total: page.total } : {}),
        });
    }

    /**
     * DELETE /events/kv-handles/:handle — take a shared region back. A handle
     * this account did not mint reads as absent.
     */
    @Delete('/kv-handles/:handle', {
        subdomain: 'api',
        requireAuth: true,
        allowAccessToken: true,
    })
    async revokeKvHandle(req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        res.json(
            await this.services.events.revokeKvHandle(actor, req.params.handle),
        );
    }

    // -- Handlers ----------------------------------------------------
    //
    // Deploying an app's code, so the gate is the same as the verbs above plus
    // the ownership check the service makes: the app token's own app, or an app
    // a user session names and that user owns.

    /** POST /events/handlers/publish — create or update one named handler. */
    @Post('/handlers/publish', {
        subdomain: 'api',
        requireAuth: true,
        allowAccessToken: true,
    })
    async publishHandler(req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        res.json(
            await this.services.events.publishHandler(actor, this.#body(req)),
        );
    }

    /** POST /events/handlers/publishAll — a build step's whole set, in order. */
    @Post('/handlers/publishAll', {
        subdomain: 'api',
        requireAuth: true,
        allowAccessToken: true,
    })
    async publishHandlers(req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        res.json({
            handlers: await this.services.events.publishHandlers(
                actor,
                this.#body(req),
            ),
        });
    }

    /** GET /events/handlers/list — names and hashes, never source. */
    @Get('/handlers/list', {
        subdomain: 'api',
        requireAuth: true,
        allowAccessToken: true,
        rateLimit: EVENTS_HANDLER_LIST_LIMIT,
    })
    async listHandlers(req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        const query = (req.query ?? {}) as Record<string, unknown>;
        res.json({
            handlers: await this.services.events.listHandlers(actor, {
                appUid:
                    typeof query.appUid === 'string' ? query.appUid : undefined,
            }),
        });
    }

    /** POST /events/handlers/remove — delete, and suspend what was bound. */
    @Post('/handlers/remove', {
        subdomain: 'api',
        requireAuth: true,
        allowAccessToken: true,
    })
    async removeHandler(req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        res.json(
            await this.services.events.removeHandler(actor, this.#body(req)),
        );
    }

    // -- Events workers ------------------------------------------------
    //
    // The billable artifact a published handler set implies. Account-scoped
    // like the kv-handle surface above: this is the owner's own view of what
    // it is paying for, so — unlike the handler routes — an app token cannot
    // act here on its owner's behalf.

    /** GET /events/workers — the caller's own events workers, one per app. */
    @Get('/workers', {
        subdomain: 'api',
        requireAuth: true,
        allowAccessToken: true,
        rateLimit: EVENTS_WORKER_LIST_LIMIT,
    })
    async listEventsWorkers(req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        const query = (req.query ?? {}) as Record<string, unknown>;

        const page = await this.services.events.listEventsWorkers(actor, {
            limit: normalizeLimit(query.limit, {
                cap: EVENTS_WORKERS_LIST_LIMIT_CAP,
            }),
            cursor: typeof query.cursor === 'string' ? query.cursor : undefined,
        });

        res.json({
            items: page.items,
            ...(page.cursor ? { cursor: page.cursor } : {}),
            deployable: page.deployable,
        });
    }

    /**
     * POST /events/workers/destroy — remove every handler an app has published,
     * taking its events worker down with the last one.
     */
    @Post('/workers/destroy', {
        subdomain: 'api',
        requireAuth: true,
        allowAccessToken: true,
    })
    async destroyEventsWorker(req: Request, res: Response): Promise<void> {
        const actor = this.#requireActor(req);
        res.json(
            await this.services.events.destroyEventsWorker(
                actor,
                this.#body(req),
            ),
        );
    }

    /**
     * POST /events/worker/rehydrate — the events dispatcher asking for a script
     * it could not find in its namespace, which is also how a handler set is
     * deployed the first time. Internal: the shared secret is the only gate,
     * and there is no actor.
     */
    @Post('/worker/rehydrate', {
        subdomain: 'api',
        // The shared secret is what gates this route, so the limit is only a
        // guessing-rate bound — hence per-IP and deliberately high. The caller
        // fans in from every edge location behind a small set of egress
        // addresses and asks once per missing script per isolate.
        rateLimit: {
            scope: 'events-worker-rehydrate',
            limit: 6000,
            window: 60_000,
            key: 'ip',
        },
    })
    async rehydrateWorker(req: Request, res: Response): Promise<void> {
        this.#requireInternalAuth(req);
        const body = this.#body(req);
        const script = String(body.script ?? '');
        const appUid = String(body.appUid ?? '');
        if (!EVENTS_SCRIPT_REGEX.test(script) || !APP_UID_REGEX.test(appUid))
            throw new HttpError(400, 'Missing or invalid `script`/`appUid`', {
                legacyCode: 'bad_request',
            });

        const deployer = this.#eventsWorkerDeployer();
        if (!deployer.enabled) {
            res.status(404).json({ deployed: false, reason: 'disabled' });
            return;
        }

        const outcome = await deployer.ensure(appUid, script);
        if (outcome === 'deployed') {
            res.json({ deployed: true });
            return;
        }
        // `failed` and `throttled` are worth another attempt: the rest say
        // this script is not what the app's handlers currently are.
        res.status(
            outcome === 'failed' || outcome === 'throttled' ? 502 : 404,
        ).json({
            deployed: false,
            reason: outcome,
        });
    }

    // -- Internals ---------------------------------------------------

    /**
     * Local development has no events dispatcher, so invocations are handed
     * straight to the local worker runtime — including the deploy-on-miss the
     * dispatcher would otherwise ask for over the rehydrate route above.
     */
    override onServerStart(): void {
        const deployer = this.#eventsWorkerDeployer();
        if (!deployer.enabled || !this.config.workers?.localServer) return;
        this.services.events.useWorkerTransport(
            new LocalEventsInvokeTransport(this.services, deployer),
        );
    }

    #deployer: EventsWorkerDeployer | null = null;

    #eventsWorkerDeployer(): EventsWorkerDeployer {
        this.#deployer ??= new EventsWorkerDeployer({
            config: this.config,
            clients: this.clients,
            stores: this.stores,
            services: this.services,
            drivers: this.drivers,
        });
        return this.#deployer;
    }

    /**
     * Constant-time, so the secret cannot be recovered a byte at a time.
     * Compares Buffer byte lengths, not string lengths — a string length
     * compares UTF-16 code units, which can differ from the byte length
     * `timingSafeEqual` actually requires to match.
     */
    #requireInternalAuth(req: Request): void {
        const expected = Buffer.from(this.config.events?.internalSecret ?? '');
        const offered = Buffer.from(
            String(req.headers['x-puter-internal-auth'] ?? ''),
        );
        const ok =
            expected.length > 0 &&
            expected.length === offered.length &&
            timingSafeEqual(expected, offered);
        if (!ok)
            throw new HttpError(403, 'Forbidden', { legacyCode: 'forbidden' });
    }

    #requireActor(req: Request): Actor {
        const actor = req.actor;
        if (!actor?.user)
            throw new HttpError(401, 'Unauthorized', {
                legacyCode: 'unauthorized',
            });
        return actor;
    }

    #body(req: Request): Record<string, unknown> {
        const body = req.body;
        if (!body || typeof body !== 'object' || Array.isArray(body))
            throw new HttpError(400, 'body must be an object', {
                legacyCode: 'bad_request',
            });
        return body as Record<string, unknown>;
    }
}
