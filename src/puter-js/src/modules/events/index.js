import { PuterModule } from '../../lib/PuterModule.js';
import { EventChannel } from './lib/channel.js';
import { EventHandlers } from './lib/handlers.js';
import { EventsWorkers } from './lib/workers.js';
import { fetch } from './fetch.js';
import { list } from './list.js';
import { onLocal } from './onLocal.js';
import { onPersistent } from './onPersistent.js';
import { unsubscribe } from './unsubscribe.js';

/** @typedef {import('../../index.js').Puter} Puter */

/**
 * Live change notifications. Subscribe to a subject — a file, a directory, a
 * path that does not exist yet — and a handler runs whenever something under
 * it changes.
 *
 * Two kinds of subscription: `onLocal()` lives with this connection and is
 * gone when the page is, while `onPersistent()` is stored against the account
 * and keeps matching with nothing open. A persistent subscription runs a
 * handler the app published through `puter.events.handlers`.
 *
 * `fetch()` is the other half: what happened while nothing was listening, read
 * from the subject's own store a page at a time.
 *
 * A published handler set stands up an **events worker** per app —
 * `puter.events.workers` is where an owner sees and destroys them.
 *
 * Method implementations live in the sibling files as `this`-context functions
 * whose JSDoc is the source of truth for the public signatures — `types/` is
 * generated from it, never edited by hand.
 */
export class EventsModule extends PuterModule {
    // The fields hold the unbound functions so they keep their full types
    // (`bind` erases overloads); the constructor rebinds them so destructured
    // calls (`const { onLocal } = puter.events`) work.
    onLocal = onLocal;
    onPersistent = onPersistent;
    unsubscribe = unsubscribe;
    list = list;
    fetch = fetch;

    /** @param {Puter} puter */
    constructor (puter) {
        super(puter);

        /**
         * @internal The single connection every subscription multiplexes
         *   over.
         */
        this.channel = new EventChannel(this);

        /** The named functions this app has deployed. */
        this.handlers = new EventHandlers(this);

        /** The events worker a published handler set implies. */
        this.workers = new EventsWorkers(this);

        const methods = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (
            /** @type {unknown} */ (this)
        );
        for ( const name of [
            'onLocal',
            'onPersistent',
            'unsubscribe',
            'list',
            'fetch',
        ] ) {
            methods[name] = methods[name].bind(this);
        }

        // The socket carries its token from the moment it connects, so a new
        // token means a new connection — and the subscriptions on the old one
        // have to be made again on it.
        puter.onAuthStateChanged(() => this.channel.reset());
    }
}

/**
 * The public face of the module: derived from the class, with the internal
 * `puter` handle, the connection plumbing, and the legacy `authToken`
 * accessor omitted.
 *
 * @typedef {import('../../lib/types.js').OmitMembers<
 *     typeof EventsModule,
 *     'puter' | 'authToken' | 'channel'
 * >} EventsConstructor
 */

export const Events = /** @type {EventsConstructor} */ (EventsModule);

export default Events;
