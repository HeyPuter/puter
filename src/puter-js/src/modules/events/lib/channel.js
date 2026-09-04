import { io } from 'socket.io-client';
import { PuterJSError } from '../../../lib/PuterJSError.js';
import { socketAutoUnref } from '../../../lib/socketOptions.js';
import { EventSubscription } from './subscription.js';

/** @typedef {import('../types.js').EventGapMarker} EventGapMarker */
/** @typedef {import('../types.js').EventHandler} EventHandler */
/** @typedef {import('../types.js').OnLocalOptions} OnLocalOptions */
/** @typedef {import('../types.js').PuterEvent} PuterEvent */
/** @typedef {import('../types.js').PuterKvEvent} PuterKvEvent */

/**
 * What the server says a subscription is, in its `subscribe` ack.
 *
 * @typedef {Object} SubscriptionView
 * @property {string} subId
 * @property {string} subject
 * @property {import('../types.js').EventAnchor} anchor
 * @property {string | null} match
 * @property {string | null} op
 */

/** @typedef {{ ok: true, sub?: SubscriptionView }} VerbAck */

// The wire, fixed by the server: three verbs answered with an ack, one channel
// events arrive on.
const SUBSCRIBE_VERB = 'events.subscribe';
const UNSUBSCRIBE_VERB = 'events.unsubscribe';
const ACK_VERB = 'events.ack';
const DELIVERY_CHANNEL = 'events.delivery';

/** How long a verb waits for its ack before the call is called lost. */
export const DEFAULT_TIMEOUT_MS = 30000;

// A reconnect re-issues every subscription at once, so the ones past the
// per-minute call budget wait this long for another pass rather than lapsing.
const RESUBSCRIBE_RETRY_MS = 10000;

/** Raised when the connection itself is the problem, never by the server. */
const connectionError = (message) =>
    new PuterJSError(message, 'events_connection_failed');

/** The server's `{ ok: false, error }` ack, passed through code and all. */
const ackError = (response) => {
    const error = /** @type {{ code?: unknown, message?: unknown } | undefined} */ (
        response && typeof response === 'object' ? response.error : undefined
    );
    return new PuterJSError(
        typeof error?.message === 'string' ? error.message : 'The events request failed',
        typeof error?.code === 'string' ? error.code : 'events_failed',
    );
};

/** The subscription an ack describes, or a failure if it describes none. */
const viewOf = (response) => {
    const view = /** @type {SubscriptionView | undefined} */ (response?.sub);
    if ( ! view || typeof view.subId !== 'string' ) {
        throw new PuterJSError('The events server sent an unexpected answer', 'events_failed');
    }
    return view;
};

/**
 * A rejected handshake carries its own code (`reauth_required`); anything else
 * is a connection that could not be made.
 */
const handshakeError = (error) => {
    const data = /** @type {{ code?: unknown } | undefined} */ (
        error && typeof error === 'object' ? error.data : undefined
    );
    const message = error instanceof Error ? error.message : 'Could not connect to the events server';
    return typeof data?.code === 'string'
        ? new PuterJSError(message, data.code)
        : connectionError(message);
};

/**
 * The one connection every subscription rides on, and the routing table that
 * makes one socket serve all of them.
 *
 * Opened by the first subscription and closed by the last, so an app that
 * never subscribes never connects. Session subscriptions die with the socket,
 * so a reconnect is not transparent server-side — this re-issues each live
 * subscription and re-points its handle at the new id, which is what keeps
 * `onLocal` a thing you call once.
 *
 * A persistent subscription is the other way round: the server holds it, its
 * id outlives every connection, and what a reconnect has to rebuild is only
 * this side's routing — so those registrations are kept apart from the session
 * ones and are never re-subscribed.
 */
export class EventChannel {
    /** @param {import('../index.js').EventsModule} module */
    constructor (module) {
        /** @internal */
        this.module = module;
        /** @internal @type {import('socket.io-client').Socket | null} */
        this.socket = null;
        /** @internal @type {Set<EventSubscription>} */
        this.subscriptions = new Set();
        /** @internal @type {Map<string, EventSubscription>} */
        this.byId = new Map();
        /**
         * @internal Persistent subscriptions this client is running the
         *   handler for, by their server-side id.
         * @type {Map<string, DurableRegistration>}
         */
        this.durable = new Map();
        /** @internal Rejectors for verbs still waiting on an ack. */
        this.waiters = new Set();
        /** @internal Subscribes that have not resolved yet. */
        this.inflight = 0;
        /**
         * @internal Bumped every time the connection goes away, so a request
         *   that failed with it can be told from one a live connection
         *   refused.
         */
        this.generation = 0;
        /** @internal @type {ReturnType<typeof setTimeout> | null} */
        this.retryTimer = null;
    }

    /**
     * @internal
     * @param {string} subject
     * @param {EventHandler} handler
     * @param {OnLocalOptions} options
     * @returns {Promise<EventSubscription>}
     */
    async subscribe (subject, handler, options) {
        const sub = new EventSubscription(this, subject, handler, options);
        this.inflight++;
        try {
            const response = await this.request(SUBSCRIBE_VERB, { subject }, timeoutFor(sub));
            sub.apply(viewOf(response));
            this.subscriptions.add(sub);
            this.byId.set(/** @type {string} */ (sub.subId), sub);
            return sub;
        } finally {
            this.inflight--;
            this.closeIfIdle();
        }
    }

    /**
     * @internal
     * @param {EventSubscription} sub
     * @returns {Promise<void>}
     */
    async remove (sub) {
        if ( ! this.subscriptions.has(sub) ) return;
        this.forget(sub);

        const subId = sub.subId;
        sub.subId = null;
        try {
            if ( subId !== null && this.socket?.connected ) {
                await this.request(UNSUBSCRIBE_VERB, { subId }, timeoutFor(sub));
            }
        } catch {
            // A session subscription is gone with its connection anyway, so
            // there is nothing an unsubscribe failure leaves behind to fix —
            // and `off()` is teardown, which does not get to fail.
        } finally {
            this.closeIfIdle();
        }
    }

    /**
     * Run a persistent subscription's handler here whenever this client is the
     * one the server delivers to. The subscription itself already exists and is
     * not re-registered by any of this — what is registered is only where its
     * deliveries go while this page is open.
     *
     * @internal
     * @param {string} subId
     * @param {import('../types.js').EventHandler} handler
     * @param {Record<string, unknown>} [ctx] The context the subscription was
     *   created with, delivered frozen alongside every event.
     * @returns {void}
     */
    registerDurable (subId, handler, ctx) {
        this.durable.set(subId, { subId, handler, ctx: Object.freeze({ ...(ctx ?? {}) }) });
        this.connect();
    }

    /**
     * Stop routing a persistent subscription here. The subscription is
     * untouched — ending it is `unsubscribe()`, which is a different thing from
     * this page no longer running its handler.
     *
     * @internal
     * @param {string} subId
     * @returns {void}
     */
    deregisterDurable (subId) {
        if ( ! this.durable.delete(subId) ) return;
        this.closeIfIdle();
    }

    /**
     * Rebuild the connection against the current token and origin. Live
     * subscriptions are re-issued once it is up.
     *
     * @internal
     * @returns {void}
     */
    reset () {
        this.close();
        if ( this.subscriptions.size > 0 || this.durable.size > 0 ) this.connect();
    }

    /**
     * @internal
     * @returns {import('socket.io-client').Socket}
     */
    connect () {
        if ( this.socket ) return this.socket;

        const socket = io(this.module.APIOrigin, {
            auth: { auth_token: this.module.authToken },
            autoUnref: socketAutoUnref(this.module.puter),
            transports: ['websocket', 'polling'],
            withCredentials: true,
        });

        socket.on('connect', () => this.resubscribe());
        socket.on('disconnect', () => {
            // socket.io reconnects on its own after a transport drop, but not
            // after the server hangs up: that socket is finished, and so is
            // everything riding it.
            if ( socket.active ) {
                this.orphan();
                return;
            }
            this.fail(connectionError('The events connection was closed by the server'));
        });
        socket.on('connect_error', error => {
            // socket.io retries on its own while the socket is still active;
            // only a refusal it will not retry is the client's problem.
            if ( socket.active ) return;
            this.fail(handshakeError(error));
        });
        socket.on(DELIVERY_CHANNEL, envelope => this.route(envelope));

        this.socket = socket;
        return socket;
    }

    /**
     * @internal
     * @param {string} verb
     * @param {Record<string, unknown>} payload
     * @param {number} timeoutMs
     * @returns {Promise<VerbAck>}
     */
    request (verb, payload, timeoutMs) {
        const socket = this.connect();
        return new Promise((resolve, reject) => {
            let settled = false;
            const abort = error => {
                if ( settled ) return;
                settled = true;
                clearTimeout(timer);
                this.waiters.delete(abort);
                reject(error);
            };
            const timer = setTimeout(
                () => abort(connectionError(`Timed out waiting for \`${verb}\``)),
                timeoutMs,
            );
            timer?.unref?.();
            this.waiters.add(abort);

            socket.emit(verb, payload, response => {
                if ( settled ) return;
                settled = true;
                clearTimeout(timer);
                this.waiters.delete(abort);
                if ( ! response || response.ok !== true ) {
                    reject(ackError(response));
                    return;
                }
                resolve(response);
            });
        });
    }

    /**
     * The server dropped every subscription this socket held when it went
     * away, so nothing here has a server-side id until it is re-issued — and
     * nothing that was waiting on an ack is going to get one.
     *
     * @internal
     * @returns {void}
     */
    orphan () {
        this.generation++;
        for ( const sub of this.subscriptions ) {
            if ( sub.subId !== null ) this.byId.delete(sub.subId);
            sub.subId = null;
            sub.pending = false;
        }
        this.rejectWaiters(connectionError('The events connection dropped'));
    }

    /**
     * @internal
     * @returns {void}
     */
    resubscribe () {
        const generation = this.generation;
        for ( const sub of [...this.subscriptions] ) {
            if ( sub.subId !== null || sub.pending ) continue;
            sub.pending = true;
            this.request(SUBSCRIBE_VERB, { subject: sub.subject }, timeoutFor(sub))
                .then(response => {
                    sub.pending = false;
                    const view = viewOf(response);
                    // `off()` while this was in flight: the handle is already
                    // gone, so drop what the server just handed us.
                    if ( ! this.subscriptions.has(sub) ) {
                        this.dropOnServer(view.subId, timeoutFor(sub));
                        return;
                    }
                    sub.apply(view);
                    this.byId.set(/** @type {string} */ (sub.subId), sub);
                })
                .catch(error => {
                    sub.pending = false;
                    if ( ! this.subscriptions.has(sub) ) return;
                    // The connection went away under it — a flaky reconnect is
                    // not a refusal, and the next connect tries again.
                    if ( this.generation !== generation ) return;
                    const failure = PuterJSError.from(error);
                    // Over the call budget says nothing about this subject.
                    if ( failure.code === 'too_many_requests' ) {
                        this.retryResubscribe(generation);
                        return;
                    }
                    this.lapse(sub, failure);
                });
        }
    }

    /**
     * Run `resubscribe` again once the call budget has had time to refill.
     * One timer covers every subscription that was turned away.
     *
     * @internal
     * @param {number} generation
     * @returns {void}
     */
    retryResubscribe (generation) {
        if ( this.retryTimer ) return;
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            if ( this.generation !== generation || ! this.socket?.connected ) return;
            this.resubscribe();
        }, RESUBSCRIBE_RETRY_MS);
        this.retryTimer?.unref?.();
    }

    /**
     * @internal
     * @param {{ subId?: string, event?: unknown, ackRequired?: boolean, ackId?: string }} envelope
     * @returns {void}
     */
    route (envelope) {
        if ( ! envelope || typeof envelope !== 'object' || ! envelope.event ) return;
        const subId = /** @type {string} */ (envelope.subId);
        const sub = this.byId.get(subId);
        if ( sub ) {
            sub.deliver(
                /** @type {PuterEvent | PuterKvEvent | EventGapMarker} */ (envelope.event),
                /** @type {Record<string, unknown> | undefined} */ (envelope.ctx),
            );
            return;
        }
        const registered = this.durable.get(subId);
        // An event for something this client has already unsubscribed from:
        // in flight when `off()` was called, and no longer anybody's.
        if ( registered ) this.runDurable(registered, envelope);
    }

    /**
     * Run a persistent subscription's handler on one delivery.
     *
     * The handler is handed the same environment its published copy gets in the
     * app's events worker, so one body runs unchanged in either place. A
     * delivery owed to exactly one consumer carries `ack`: calling it settles
     * the delivery, resolving without calling it settles it anyway, and
     * throwing settles nothing — the lease lapses and it is delivered again.
     *
     * @internal
     * @param {DurableRegistration} registration
     * @param {{ event?: unknown, ackRequired?: boolean, ackId?: string, origin?: string }} envelope
     * @returns {void}
     */
    runDurable (registration, envelope) {
        const event = /** @type {PuterEvent | PuterKvEvent | EventGapMarker} */ (envelope.event);
        const { puter } = this.module;
        const delivery = {
            event,
            ctx: registration.ctx,
            user: puter,
            fetch: puter?.net?.fetch ?? globalThis.fetch,
        };

        if ( ! envelope.ackRequired || typeof envelope.ackId !== 'string' ) {
            settleHandler(() => registration.handler(delivery));
            return;
        }

        let acked = false;
        const ack = () => {
            if ( acked ) return Promise.resolve();
            acked = true;
            return this.ack(
                registration.subId,
                /** @type {string} */ (envelope.ackId),
                envelope.origin,
            );
        };
        settleHandler(
            () => registration.handler({ ...delivery, ack }),
            () => ack(),
        );
    }

    /**
     * Tell the server a delivery was taken. Best effort: a lost ack is a
     * redelivery, which `single` callers are told to expect, and there is
     * nothing a failure here leaves for the caller to fix.
     *
     * @internal
     * @param {string} subId
     * @param {string} ackId
     * @param {string} [origin] Echoed back untouched: it names whichever
     *   deployment is holding the delivery, which need not be the one this
     *   connection reached.
     * @returns {Promise<void>}
     */
    async ack (subId, ackId, origin) {
        try {
            await this.request(
                ACK_VERB,
                { subId, id: ackId, ...(origin ? { origin } : {}) },
                DEFAULT_TIMEOUT_MS,
            );
        } catch (error) {
            console.warn('[puter.events] could not acknowledge a delivery', error);
        }
    }

    /**
     * The connection is not coming back: fail what is waiting on it and end
     * every subscription it was carrying.
     *
     * @internal
     * @param {PuterJSError} error
     * @returns {void}
     */
    fail (error) {
        this.rejectWaiters(error);
        for ( const sub of [...this.subscriptions] ) this.lapse(sub, error);
        this.close();
    }

    /**
     * @internal
     * @param {EventSubscription} sub
     * @param {PuterJSError} error
     * @returns {void}
     */
    lapse (sub, error) {
        this.forget(sub);
        sub.subId = null;
        if ( ! sub.onError ) {
            console.warn(`[puter.events] subscription to ${sub.subject} lapsed`, error);
        } else {
            try {
                sub.onError(error);
            } catch (handlerError) {
                console.error('[puter.events] onError handler failed', handlerError);
            }
        }
        this.closeIfIdle();
    }

    /**
     * @internal
     * @param {EventSubscription} sub
     * @returns {void}
     */
    forget (sub) {
        this.subscriptions.delete(sub);
        if ( sub.subId !== null ) this.byId.delete(sub.subId);
    }

    /**
     * @internal
     * @param {PuterJSError} error
     * @returns {void}
     */
    rejectWaiters (error) {
        for ( const abort of [...this.waiters] ) abort(error);
        this.waiters.clear();
    }

    /**
     * Best-effort removal of a subscription no handle points at any more.
     *
     * @internal
     * @param {string} subId
     * @param {number} timeoutMs
     * @returns {void}
     */
    dropOnServer (subId, timeoutMs) {
        if ( ! this.socket?.connected ) return;
        this.request(UNSUBSCRIBE_VERB, { subId }, timeoutMs).catch(() => {});
    }

    /**
     * @internal
     * @returns {void}
     */
    closeIfIdle () {
        if ( this.subscriptions.size > 0 || this.inflight > 0 ) return;
        if ( this.durable.size > 0 ) return;
        this.close();
    }

    /**
     * @internal
     * @returns {void}
     */
    close () {
        if ( this.retryTimer ) clearTimeout(this.retryTimer);
        this.retryTimer = null;
        const socket = this.socket;
        if ( ! socket ) return;
        this.socket = null;
        this.orphan();
        socket.removeAllListeners();
        socket.disconnect();
    }
}

/**
 * @param {EventSubscription} sub
 * @returns {number}
 */
const timeoutFor = (sub) =>
    typeof sub.timeout === 'number' && sub.timeout > 0 ? sub.timeout : DEFAULT_TIMEOUT_MS;

/**
 * One persistent subscription this client runs the handler for.
 *
 * @typedef {Object} DurableRegistration
 * @property {string} subId
 * @property {import('../types.js').EventHandler} handler
 * @property {Readonly<Record<string, unknown>>} ctx
 */

/**
 * Run a handler and, if it finishes without throwing, do whatever the delivery
 * still needs. A handler that throws is the app's bug: it is reported, and
 * nothing is settled on its behalf.
 *
 * @param {() => unknown} run
 * @param {() => unknown} [onResolved]
 * @returns {void}
 */
const settleHandler = (run, onResolved) => {
    try {
        const result = run();
        if ( result instanceof Promise ) {
            result.then(
                () => onResolved?.(),
                error => console.error('[puter.events] subscription handler failed', error),
            );
            return;
        }
        onResolved?.();
    } catch (error) {
        console.error('[puter.events] subscription handler failed', error);
    }
};
