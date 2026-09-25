import { PuterJSError } from '../../../lib/PuterJSError.js';
import { request } from './api.js';
import { prepareHandler } from './handlerSource.js';

/** @typedef {import('../types.js').PublishedHandler} PublishedHandler */
/** @typedef {import('../types.js').HandlerSummary} HandlerSummary */
/** @typedef {import('../types.js').HandlerOptions} HandlerOptions */
/** @typedef {import('../types.js').HandlerPublication} HandlerPublication */

/**
 * `puter.events.handlers` — the named functions an app deploys once and its
 * users' subscriptions bind to.
 *
 * Publishing is a developer operation: an app token publishes into its own app,
 * and a plain session has to name an app it owns. Nothing here triggers a
 * handler — a name is a label for deployed code, and it runs only when a
 * subscription bound to it has a delivery.
 *
 * Two build steps publishing different source under one name is a race with no
 * right winner, so this sends the hash it last saw published (`ifHash`) and
 * lets the server refuse a publish whose base has moved. `replace: true` is how
 * a caller says it means to take the name regardless.
 */

/** One name in one app. The same name means different code in another. */
const baseKey = (appUid, name) => `${appUid ?? ''}|${name}`;

const invalidName = () =>
    new PuterJSError(
        'A handler name must be a non-empty string',
        'events_handler_name_invalid',
    );

export class EventHandlers {
    /** @param {import('../index.js').EventsModule} module */
    constructor (module) {
        /** @internal */
        this.module = module;
        /**
         * @internal The hash last seen published, keyed by app and name — the
         *   base a publish claims it is updating. Empty until this client has
         *   published or listed, which is what makes a first publish
         *   create-or-idempotent. Keyed by app as well as name because one
         *   name means different code in two apps.
         * @type {Map<string, string>}
         */
        this.known = new Map();

        for ( const name of ['publish', 'publishAll', 'list', 'remove'] ) {
            this[name] = this[name].bind(this);
        }
    }

    /**
     * Publishes one named handler.
     *
     * @param {string} name The name subscriptions bind to.
     * @param {Function | string | { file: string }} handler The handler: a
     *   function (serialized with `toString()`), its source, or a path to read
     *   it from. A file resolves now, not at delivery.
     * @param {HandlerOptions} [options]
     * @returns {Promise<PublishedHandler>}
     */
    async publish (name, handler, options = {}) {
        const [published] = await this.#send(
            [{ name, handler, replace: options.replace }],
            options.appUid,
            '/events/handlers/publish',
        );
        return published;
    }

    /**
     * Publishes a set of handlers in one call — what a build step has. Items
     * are taken in order, and one the server refuses stops the pass, so a
     * deploy never reports success over a half-published set.
     *
     * @param {HandlerPublication[]} handlers
     * @param {HandlerOptions} [options]
     * @returns {Promise<PublishedHandler[]>}
     */
    async publishAll (handlers, options = {}) {
        if ( ! Array.isArray(handlers) || handlers.length === 0 ) {
            throw new PuterJSError(
                '`handlers` must be a non-empty array',
                'invalid_request',
            );
        }
        return this.#send(handlers, options.appUid, '/events/handlers/publishAll');
    }

    /**
     * What this app has published: names, source hashes, and how many
     * subscriptions each is carrying. Never the source.
     *
     * @param {HandlerOptions} [options]
     * @returns {Promise<HandlerSummary[]>}
     */
    async list (options = {}) {
        const response = await request(
            this.module.puter,
            '/events/handlers/list',
            undefined,
            options.appUid ? { appUid: options.appUid } : undefined,
        );
        const handlers = /** @type {HandlerSummary[]} */ (response.handlers ?? []);
        for ( const handler of handlers )
            this.known.set(baseKey(options.appUid, handler.name), handler.hash);
        return handlers;
    }

    /**
     * Removes a name. With nothing bound to it the handler simply goes; with
     * subscriptions on it they are **suspended**, not deleted, and publishing
     * the name again resumes them.
     *
     * @param {string} name
     * @param {HandlerOptions} [options]
     * @returns {Promise<{ name: string, removed: boolean, suspended: number }>}
     */
    async remove (name, options = {}) {
        if ( typeof name !== 'string' || name.trim().length === 0 ) throw invalidName();
        const removed = /** @type {{ name: string, removed: boolean, suspended: number }} */ (
            await request(this.module.puter, '/events/handlers/remove', {
                name,
                ...(options.appUid ? { appUid: options.appUid } : {}),
            })
        );
        this.known.delete(baseKey(options.appUid, name));
        return removed;
    }

    /**
     * @internal Drop every cached publish base for an app, after something
     *   removed its whole set. Sending a base for a name that is gone is what
     *   makes the next publish look like a lost race. The implicit-app keys go
     *   too: those are an app token's own app, which is the only app it can
     *   have emptied.
     * @param {string} appUid
     */
    forget (appUid) {
        for ( const key of [...this.known.keys()] ) {
            if ( key.startsWith(`${appUid}|`) || key.startsWith('|') )
                this.known.delete(key);
        }
    }

    /**
     * @internal Serialize, scan and send one or more publications, then record
     *   what is now published so the next publish can name its base.
     * @param {HandlerPublication[]} items
     * @param {string | undefined} appUid
     * @param {string} route
     * @returns {Promise<PublishedHandler[]>}
     */
    async #send (items, appUid, route) {
        const handlers = [];
        for ( const item of items ) {
            const name = item?.name;
            if ( typeof name !== 'string' || name.trim().length === 0 ) throw invalidName();

            const { source } = await prepareHandler(this.module.puter, item.handler);
            const ifHash = this.known.get(baseKey(appUid, name));
            handlers.push({
                name,
                source,
                ...(item.replace === true ? { replace: true } : {}),
                ...(ifHash && item.replace !== true ? { ifHash } : {}),
            });
        }

        const body = {
            ...(appUid ? { appUid } : {}),
            ...(handlers.length === 1 && route.endsWith('/publish')
                ? handlers[0]
                : { handlers }),
        };

        const response = await request(this.module.puter, route, body);
        const published = /** @type {PublishedHandler[]} */ (
            Array.isArray(response.handlers) ? response.handlers : [response]
        );
        for ( const handler of published )
            this.known.set(baseKey(appUid, handler.name), handler.hash);
        return published;
    }
}
