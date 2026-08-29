import { PuterModule } from '../../lib/PuterModule.js';
import { EventChannel } from './lib/channel.js';
import { onLocal } from './onLocal.js';

/** @typedef {import('../../index.js').Puter} Puter */

/**
 * Live change notifications. Subscribe to a subject — a file, a directory, a
 * path that does not exist yet — and a handler runs whenever something under
 * it changes.
 *
 * Method implementations live in the sibling files as `this`-context functions
 * whose JSDoc is the source of truth for the public signatures — `types/` is
 * generated from it, never edited by hand.
 */
export class EventsModule extends PuterModule {
    // The field holds the unbound function so it keeps its full type (`bind`
    // erases overloads); the constructor rebinds it so destructured calls
    // (`const { onLocal } = puter.events`) work.
    onLocal = onLocal;

    /** @param {Puter} puter */
    constructor (puter) {
        super(puter);

        /**
         * @internal The single connection every subscription multiplexes
         *   over.
         */
        this.channel = new EventChannel(this);

        const methods = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (
            /** @type {unknown} */ (this)
        );
        methods.onLocal = methods.onLocal.bind(this);

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
