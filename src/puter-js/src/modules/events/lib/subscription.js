/** @typedef {import('../types.js').EventAnchor} EventAnchor */
/** @typedef {import('../types.js').EventGapMarker} EventGapMarker */
/** @typedef {import('../types.js').EventHandler} EventHandler */
/** @typedef {import('../types.js').PuterEvent} PuterEvent */
/** @typedef {import('../types.js').PuterKvEvent} PuterKvEvent */

/**
 * A live subscription, as returned by `puter.events.onLocal()`.
 *
 * The handle survives reconnects: the connection dying takes the server's
 * subscription with it, the SDK makes a new one, and this object keeps
 * pointing at it — with a new `subId`, which is why nothing should be stored
 * against that id.
 */
export class EventSubscription {
    /** The subject this was subscribed with. */
    subject;

    /**
     * The server's id for the current subscription, or `null` while the
     * connection is down. Changes on every reconnect.
     *
     * @type {string | null}
     */
    subId = null;

    /**
     * The node the subscription is keyed to, which is the nearest existing
     * ancestor when the subject named something that does not exist yet.
     *
     * @type {EventAnchor | null}
     */
    anchor = null;

    /**
     * The pattern events under the anchor are matched against, or `null` when
     * the subject named the anchor itself.
     *
     * @type {string | null}
     */
    match = null;

    /**
     * The single operation this subscription is limited to, or `null` for all
     * of them.
     *
     * @type {string | null}
     */
    op = null;

    /**
     * @internal
     * @param {import('./channel.js').EventChannel} channel
     * @param {string} subject
     * @param {EventHandler} handler
     * @param {{ onError?: (error: Error & { code?: string }) => void, timeout?: number }} options
     */
    constructor (channel, subject, handler, options = {}) {
        /** @internal @type {import('./channel.js').EventChannel} */
        this.channel = channel;
        this.subject = subject;
        /** @internal @type {EventHandler} */
        this.handler = handler;
        /** @internal @type {((error: Error & { code?: string }) => void) | undefined} */
        this.onError = options.onError;
        /** @internal @type {number | undefined} */
        this.timeout = options.timeout;
        /** @internal Set while a subscribe for this handle is in flight. */
        this.pending = false;

        this.off = this.off.bind(this);
    }

    /**
     * Ends the subscription. Routing stops immediately; the server is told
     * when there is still a connection to tell it over. Safe to call more than
     * once, and after the connection has gone away — it never throws.
     *
     * @returns {Promise<void>}
     */
    async off () {
        await this.channel.remove(this);
    }

    /**
     * @internal
     * @param {PuterEvent | PuterKvEvent | EventGapMarker} event
     * @param {Record<string, unknown>} [ctx] The subscription's stored
     *   context, which the handler must not be able to mutate: it is one
     *   snapshot shared across every delivery.
     * @returns {void}
     */
    deliver (event, ctx) {
        try {
            const result = this.handler(
                ctx === undefined ? { event } : { event, ctx: Object.freeze(ctx) },
            );
            if ( result instanceof Promise ) {
                result.catch(reportHandlerError);
            }
        } catch (error) {
            reportHandlerError(error);
        }
    }

    /**
     * @internal
     * @param {{ subId: string, anchor?: EventAnchor, match?: string | null, op?: string | null }} view
     * @returns {void}
     */
    apply (view) {
        this.subId = view.subId;
        this.anchor = view.anchor ?? null;
        this.match = view.match ?? null;
        this.op = view.op ?? null;
    }
}

/**
 * A handler that throws is the app's bug, not the subscription's: report it
 * and keep delivering.
 *
 * @param {unknown} error
 * @returns {void}
 */
const reportHandlerError = (error) => {
    console.error('[puter.events] subscription handler failed', error);
};
