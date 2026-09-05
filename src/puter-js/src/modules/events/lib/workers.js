import { PuterJSError } from '../../../lib/PuterJSError.js';
import { request } from './api.js';

/** @typedef {import('../types.js').EventsWorkersListOptions} EventsWorkersListOptions */
/** @typedef {import('../types.js').EventsWorkerPage} EventsWorkerPage */
/** @typedef {import('../types.js').DestroyedEventsWorker} DestroyedEventsWorker */

/**
 * `puter.events.workers` — the per-app events worker a published handler set
 * implies.
 *
 * An app's events worker exists once it has at least one published handler,
 * and goes away with the last one — whether that is removing handlers one by
 * one or calling `destroy()` here. A hosted deployment may bill it as a
 * standing cost per app, which is what this surface exists for: an account
 * needs somewhere to see and stop paying for one.
 *
 * Account-scoped, unlike `puter.events.handlers`: this is the caller's own
 * view of what it is running, across every app it owns, so it takes no
 * `appUid` on `list()` and an app token cannot act here on its owner's behalf.
 */

const invalidAppUid = () =>
    new PuterJSError(
        '`appUid` must be a non-empty string',
        'invalid_request',
    );

export class EventsWorkers {
    /** @param {import('../index.js').EventsModule} module */
    constructor (module) {
        /** @internal */
        this.module = module;

        for ( const name of ['list', 'destroy'] ) {
            this[name] = this[name].bind(this);
        }
    }

    /**
     * The caller's own events workers, one per app it owns with at least one
     * published handler.
     *
     * @param {EventsWorkersListOptions} [options]
     * @returns {Promise<EventsWorkerPage>}
     */
    async list (options = {}) {
        const response = await request(
            this.module.puter,
            '/events/workers',
            undefined,
            {
                ...(options.limit !== undefined ? { limit: options.limit } : {}),
                ...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
            },
        );
        return /** @type {EventsWorkerPage} */ ({
            items: Array.isArray(response.items) ? response.items : [],
            ...(typeof response.cursor === 'string' ? { cursor: response.cursor } : {}),
            deployable: response.deployable === true,
        });
    }

    /**
     * Removes every handler an app has published, taking its events worker
     * down with the last one. Subscriptions bound to them are **suspended**,
     * the same as removing each by name — never deleted.
     *
     * @param {string} appUid
     * @returns {Promise<DestroyedEventsWorker>}
     */
    async destroy (appUid) {
        if ( typeof appUid !== 'string' || appUid.trim().length === 0 ) throw invalidAppUid();
        const destroyed = /** @type {DestroyedEventsWorker} */ (
            await request(this.module.puter, '/events/workers/destroy', { appUid })
        );
        this.module.handlers?.forget(appUid);
        return destroyed;
    }
}
