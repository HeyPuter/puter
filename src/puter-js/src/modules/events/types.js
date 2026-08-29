// Shapes shared across the `puter.events` surface. JSDoc-only; no runtime exports.

/**
 * The node a subscription is keyed to. For a subject naming something that
 * does not exist yet, this is the nearest existing ancestor and the rest of
 * the subject became `match`.
 *
 * @typedef {Object} EventAnchor
 * @property {string} uid The anchor node's uid.
 * @property {string} path The anchor node's absolute path.
 */

/**
 * One change, as the server projects it. Nothing internal is included: a
 * subscriber gets the node, when it happened, and whether it was their own
 * doing.
 *
 * @typedef {Object} PuterEvent
 * @property {string} id Unique id for this event. Stable across the
 *   subscriptions it was delivered to.
 * @property {string} subject The subject the delivery was projected onto,
 *   naming the node it happened to — `fs:<uid>:<op>`. Not the subject string
 *   you subscribed with.
 * @property {'add' | 'write' | 'move' | 'remove' | 'meta'} op What happened.
 * @property {string} uid The uid of the node the event is about.
 * @property {string} path The path of the node the event is about.
 * @property {boolean} self `true` when the change was made by the account
 *   holding the subscription — the flag to check to ignore your own writes.
 * @property {number} ts Milliseconds since the epoch.
 * @property {number} seq Position within one dispatch, for events that fan out
 *   to several subscriptions at once.
 */

/**
 * Stands in for events that happened and were not delivered — a per-event
 * ceiling was hit, or deliveries were coming faster than the subscription's
 * allowance. It carries no `uid` or `path`, because what was dropped is
 * exactly what it cannot name: treat it as "re-read the anchor", never as
 * "nothing changed".
 *
 * @typedef {Object} EventGapMarker
 * @property {string} id Unique id for the dispatch the gap happened in.
 * @property {string} subject The subject that was being delivered.
 * @property {'gap'} op Always `'gap'`.
 * @property {string} reason Why the delivery was dropped —
 *   `matched_subscription_limit`, `filter_evaluation_limit`, or
 *   `delivery_rate_limit`.
 * @property {number} ts Milliseconds since the epoch.
 */

/**
 * What a handler is called with. An object rather than the event itself, so
 * more can be added to the call without breaking existing handlers.
 *
 * @typedef {Object} EventDelivery
 * @property {PuterEvent | EventGapMarker} event The delivered event, or a gap
 *   marker in place of events that were dropped.
 */

/**
 * A subscription handler. Its return value is ignored; a rejected promise is
 * reported and does not affect the subscription.
 *
 * @typedef {(delivery: EventDelivery) => unknown} EventHandler
 */

/**
 * Options for {@link import('./onLocal.js').onLocal}.
 *
 * @typedef {Object} OnLocalOptions
 * @property {(error: Error & { code?: string }) => void} [onError] Called if
 *   the subscription lapses — the connection was lost and re-subscribing
 *   failed. The subscription is gone by then and the handler will not be
 *   called again; subscribe again to resume. Without this, a lapse is reported
 *   on the console.
 * @property {number} [timeout] How long to wait for the server to answer
 *   `subscribe`, in milliseconds. Default `30000`.
 */
