// Shapes shared across the `puter.events` surface. JSDoc-only; no runtime exports.

/**
 * What a subscription is keyed to. For an `fs:` subject naming something that
 * does not exist yet, this is the nearest existing ancestor and the rest of the
 * subject became `match`. For a `kv:` subject there is no node: `uid` is the app
 * whose store is watched and `path` is the key prefix it anchors at; for one made
 * through a share handle, `uid` is the handle and `path` is empty.
 *
 * @typedef {Object} EventAnchor
 * @property {string} uid The anchor node's uid, or the watched app's id.
 * @property {string} path The anchor node's absolute path, or the key prefix.
 */

/**
 * One filesystem change, as the server projects it. Nothing internal is
 * included: a subscriber gets the node, when it happened, and whether it was
 * their own doing.
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
 * @property {string} [from] On a `move`, the path the node left — present only
 *   when the subscription was watching that side.
 * @property {boolean} self `true` when the change was made by the account
 *   holding the subscription — the flag to check to ignore your own writes.
 * @property {number} ts Milliseconds since the epoch.
 * @property {number} seq Position within one dispatch, for events that fan out
 *   to several subscriptions at once.
 */

/**
 * One key-value change. It carries `key` where a filesystem event carries `uid`
 * and `path` — a KV change happens to a key in a store, and there is no node to
 * name — and never the new value, so a delivery cannot become a read.
 *
 * @typedef {Object} PuterKvEvent
 * @property {string} id Unique id for this event.
 * @property {string} subject `kv:<appId>:<key>`, naming the key that changed.
 * @property {'set' | 'del' | 'expire'} op `set` for a write, `del` for a
 *   removal, `expire` when only the key's lifetime changed.
 * @property {string} key The key the event is about.
 * @property {boolean} self `true` when the change was made by the account
 *   holding the subscription.
 * @property {number} ts Milliseconds since the epoch.
 * @property {number} seq Position within one dispatch, for events that fan out
 *   to several subscriptions at once.
 */

/**
 * One notification, as the events layer projects it. The same object whether it
 * arrived live or came back from `fetch()`, and `id` is the notification's own
 * uid on both — which is what lets a client that reconnects mid-catch-up drop
 * the copy it already has.
 *
 * @typedef {Object} PuterNotifEvent
 * @property {string} id The notification's uid, and the dedup key.
 * @property {string} subject `notif:<appId|userId>:<audience>`, naming the
 *   slice of the mailbox it belongs to.
 * @property {'post'} op Always `'post'` — the mailbox verbs (marking one read
 *   or dismissed) are their own surface, not events.
 * @property {string} uid The notification's uid, as the mailbox names it.
 * @property {string} type What kind of notification it is, from the published
 *   catalog — `share.received`, `app.worker.deployed`, and so on.
 * @property {'account' | 'developer' | 'app-user'} audience Who the recipient
 *   is in relation to it: their account, an app they own, or an app they use.
 * @property {string | null} appUid The app it is about, or `null` for one from
 *   the platform itself.
 * @property {Record<string, unknown>} notification The payload — `title`,
 *   `text`, `icon`, `fields` — exactly as the desktop receives it.
 * @property {boolean} self Always `true`: a mailbox is your own.
 * @property {number} ts When it was created, in milliseconds since the epoch.
 * @property {number} seq Position within one dispatch.
 */

/**
 * Options for {@link import('./fetch.js').fetch}.
 *
 * @typedef {Object} EventFetchOptions
 * @property {string} subject What to read. Only `notif:` subjects have a store
 *   behind them — `notif:account` for your account's notifications,
 *   `notif:app-user` for an app's own, or `notif:<appId>:<audience>` in full.
 * @property {string} [after] The `cursor` from the previous page. Absent starts
 *   from the oldest notification still kept.
 * @property {number} [limit] Events per page. Capped at 200; defaults to 50.
 */

/**
 * One page of missed events.
 *
 * @typedef {Object} EventFetchPage
 * @property {PuterNotifEvent[]} items The events, oldest first.
 * @property {string} [cursor] Pass as `after` to read the next page. Absent
 *   means there is nothing after this page — for now.
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
 *   `matched_subscription_limit`, `filter_evaluation_limit`,
 *   `delivery_rate_limit`, `backlog_overflow` when undelivered events were
 *   shed to stay inside a backlog cap, `suspended_backlog_expired` when a
 *   suspended subscription held them past its deadline, or `handler_rejected`
 *   when the subscription's handler refused the delivery outright.
 * @property {number} ts Milliseconds since the epoch.
 */

/**
 * What a handler is called with. An object rather than the event itself, so
 * more can be added to the call without breaking existing handlers.
 *
 * The last three arrive only on a persistent subscription, and are what let one
 * handler body run unchanged here and in the app's events worker.
 *
 * @typedef {Object} EventDelivery
 * @property {PuterEvent | PuterKvEvent | EventGapMarker} event The delivered
 *   event, or a gap marker in place of events that were dropped.
 * @property {Readonly<Record<string, unknown>>} [ctx] The `context` the
 *   subscription was created with, frozen. Present only for a persistent
 *   subscription; a session subscription carries none.
 * @property {unknown} [user] A `puter` bound to the account holding the
 *   subscription — the ambient one when the handler runs in a client.
 * @property {(input: unknown, init?: unknown) => Promise<unknown>} [fetch]
 *   `puter.net.fetch` where it exists, the environment's `fetch` otherwise.
 * @property {() => Promise<void>} [ack] Settles the delivery. Present only on a
 *   `single` subscription: calling it hands the delivery back as taken,
 *   returning without calling it does the same, and throwing does neither — the
 *   delivery is offered again when its lease lapses.
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

/**
 * Options for {@link import('./onPersistent.js').onPersistent}.
 *
 * @typedef {Object} OnPersistentOptions
 * @property {string} subject What to watch — the same grammar `onLocal()`
 *   takes, e.g. `fs:~/Documents` or `fs:~/inbox/*.json:add`.
 * @property {'broadcast' | 'single'} [delivery] `broadcast` (the default)
 *   delivers to everything listening; `single` delivers to exactly one
 *   consumer, which must acknowledge, and requires a `handlerName`.
 * @property {Array<'socket' | 'worker' | 'push'>} [targets] Transports the
 *   deliveries may take. Defaults to `['socket', 'worker']`. A `single`
 *   subscription may not target `push`.
 * @property {string} [handlerName] The published handler this subscription
 *   binds to. Required for `single`.
 * @property {Function | string | { file: string }} [handler] The handler
 *   source this subscription was written against. Sent as a hash, not as
 *   source: the subscription binds only if it matches what is published under
 *   `handlerName`, which is also required when this is given.
 * @property {Record<string, unknown>} [context] Values the handler needs,
 *   evaluated **now** and delivered as a frozen `ctx` on every invocation.
 *   Capped at 4 KB serialized.
 * @property {number | string} [expiresAt] When the subscription ends by
 *   itself — unix seconds or an ISO-8601 string, and it has to be in the
 *   future.
 */

/**
 * A subscription that outlives the connection that made it.
 *
 * `context` values are deliberately absent: the column holds whatever secret
 * the handler needs, and a listing is the one surface an app can call
 * repeatedly. What comes back is its shape — which keys are set, and a hash
 * that changes when any value does.
 *
 * @typedef {Object} PersistentSubscription
 * @property {string} subId The subscription's id, and what `unsubscribe()`
 *   names. Stable for the life of the subscription.
 * @property {string} subject The subject it was created with.
 * @property {EventAnchor} anchor The node it is keyed to.
 * @property {string | null} match The pattern events under the anchor are
 *   matched against, or `null` when the subject named the anchor itself.
 * @property {string | null} op The single operation it is limited to, or
 *   `null` for all of them.
 * @property {Array<'socket' | 'worker' | 'push'>} targets Transports its
 *   deliveries may take.
 * @property {'broadcast' | 'single'} delivery Its delivery class.
 * @property {string | null} handlerName The handler it is bound to.
 * @property {string | null} appUid The app that created it, or `null` for one
 *   an account session made.
 * @property {string[] | null} contextKeys Key names of its stored context,
 *   never the values, or `null` when it carries none.
 * @property {string | null} contextHash Hash of its stored context, so a
 *   change is visible without the values.
 * @property {number} createdAt Unix seconds.
 * @property {number | null} expiresAt Unix seconds, or `null` for one with no
 *   end.
 * @property {number | null} suspendedAt When it stopped delivering without
 *   being removed, or `null` while it is live.
 * @property {string | null} suspendedReason Why it stopped —
 *   `handler_not_found`, `failures`, `no_credit`, or `permission_revoked`.
 * @property {() => Promise<void>} [off] Ends the subscription: stops running
 *   its handler here and unsubscribes it. Present on the subscription
 *   `onPersistent()` returns, not on one a listing reports.
 */

/**
 * Where a handler operation applies. An app token publishes into its own app
 * and needs neither field; an account session has to name an app it owns.
 *
 * @typedef {Object} HandlerOptions
 * @property {boolean} [replace] Take the name whatever is published under it.
 *   Without this, a publish whose base has moved is refused with
 *   `events_handler_conflict`.
 * @property {string} [appUid] The app to publish into. Required when the
 *   caller is an account session rather than an app.
 */

/**
 * One item of a `publishAll()` set.
 *
 * @typedef {Object} HandlerPublication
 * @property {string} name The name subscriptions bind to.
 * @property {Function | string | { file: string }} handler The handler: a
 *   function, its source, or a path to read it from.
 * @property {boolean} [replace] Take the name whatever is published under it.
 */

/**
 * What a publish reports back. Never the source.
 *
 * @typedef {Object} PublishedHandler
 * @property {string} name
 * @property {string} hash SHA-256 of the published source.
 * @property {number} updatedAt Unix seconds.
 * @property {'created' | 'updated' | 'unchanged'} outcome What the publish
 *   did. `unchanged` means the same source was already published.
 * @property {number} resumed Suspended subscriptions this publish brought
 *   back into service.
 */

/**
 * One handler as `puter.events.handlers.list()` reports it.
 *
 * @typedef {Object} HandlerSummary
 * @property {string} name
 * @property {string} hash SHA-256 of the published source.
 * @property {number} updatedAt Unix seconds.
 * @property {number} subscriptions How many subscriptions are bound to this
 *   name, suspended ones included.
 */

/**
 * Options for `puter.events.workers.list()`.
 *
 * @typedef {Object} EventsWorkersListOptions
 * @property {number} [limit] Apps per page.
 * @property {string} [cursor] The `cursor` from a previous page. Absent starts
 *   from the first page.
 */

/**
 * One app of the caller's with published handlers — and so with an events
 * worker standing behind them.
 *
 * @typedef {Object} EventsWorkerSummary
 * @property {string} appUid
 * @property {string} appName
 * @property {string} appTitle
 * @property {number} handlerCount How many handlers this app has published.
 * @property {number} createdAt When this app's events worker first came into
 *   being — its earliest published handler. Unix seconds.
 * @property {number} updatedAt Its most recently published or updated handler.
 *   Unix seconds.
 * @property {string} script The deployed script name, for support/diagnosis.
 */

/**
 * One page of `puter.events.workers.list()`.
 *
 * @typedef {Object} EventsWorkerPage
 * @property {EventsWorkerSummary[]} items
 * @property {string} [cursor] Pass to read the next page. Absent means there
 *   is no next page.
 * @property {boolean} deployable Whether this server actually deploys events
 *   workers. `false` on a self-hosted install without the runtime turned on —
 *   apps can still publish handlers, but nothing runs a background delivery.
 */

/**
 * What `puter.events.workers.destroy()` reports back.
 *
 * @typedef {Object} DestroyedEventsWorker
 * @property {string} appUid
 * @property {number} removed How many handlers were deleted.
 * @property {number} suspended How many subscriptions were suspended as a
 *   result, across all of them.
 */
