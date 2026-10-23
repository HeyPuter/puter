import { PuterJSError } from '../../../lib/PuterJSError.js';
import { toNotification } from './shapes.js';

/** From an app, its own slice of the user's mailbox. */
export const SUBJECT = 'notif:app-user';

const PAGE_SIZE = 200;
const MAX_PAGES = 50;

// Both codes mean notifications are not routed through events on this server.
export const unavailable = (error) => {
    const failure = PuterJSError.from(error);
    if (
        failure.code !== 'events_disabled' &&
        failure.code !== 'invalid_subject'
    ) {
        return failure;
    }
    return new PuterJSError(
        'Live notifications are not enabled on this server',
        'events_disabled',
        { cause: failure },
    );
};

const report = (error) => {
    console.error('[puter.notifications] notification handler failed', error);
};

/** A live subscription plus reads of what it missed, each uid handed over once. */
export class NotificationFeed {
    /** @type {import('../../../index.js').Puter} */
    #puter;
    /** @type {import('../types.js').NotificationHandler} */
    #handler;
    /** @type {((error: Error & { code?: string }) => void) | undefined} */
    #onError;
    #catchUp;
    /** @type {number | undefined} */
    #since;

    #seen = new Set();
    /** What was already there when a listener started without catch-up. */
    #baseline = new Set();
    /** @type {string | undefined} */
    #cursor;
    /** @type {Promise<void> | null} */
    #reading = null;
    /** @type {unknown[]} */
    #queued = [];
    /** @type {{ off: () => Promise<void> } | null} */
    #subscription = null;
    #stopped = false;

    constructor(puter, handler, options) {
        this.#puter = puter;
        this.#handler = handler;
        this.#onError = options.onError;
        this.#catchUp = options.catchUp !== false;
        this.#since =
            typeof options.since === 'number' ? options.since : undefined;
    }

    /** @returns {Promise<void>} */
    async start() {
        try {
            this.#subscription = await this.#puter.events.onLocal(
                SUBJECT,
                ({ event }) => this.#receive(event),
                {
                    onError: (error) => {
                        this.#stopped = true;
                        this.#fail(error);
                    },
                },
            );
        } catch (error) {
            throw unavailable(error);
        }

        try {
            // Without catch-up the first read only marks what is already there.
            await this.#read(this.#catchUp);
        } catch (error) {
            await this.off();
            throw unavailable(error);
        }
    }

    /** @returns {Promise<void>} */
    async off() {
        this.#stopped = true;
        this.#queued = [];
        const subscription = this.#subscription;
        this.#subscription = null;
        await subscription?.off();
    }

    #receive(event) {
        if (this.#stopped) return;
        if (event?.op === 'gap') {
            this.#read(true).catch((error) => {
                if (!this.#stopped) this.#fail(PuterJSError.from(error));
            });
            return;
        }
        if (this.#reading) {
            this.#queued.push(event);
            return;
        }
        this.#deliver(event, 'live');
    }

    // Live events wait in `#queued` meanwhile, so delivery stays oldest first.
    #read(deliver) {
        if (this.#reading) return this.#reading;
        this.#reading = (async () => {
            try {
                for (let page = 0; page < MAX_PAGES && !this.#stopped; page++) {
                    const result = await this.#puter.events.fetch({
                        subject: SUBJECT,
                        limit: PAGE_SIZE,
                        ...(this.#cursor ? { cursor: this.#cursor } : {}),
                    });
                    for (const event of result.items) {
                        this.#deliver(event, deliver ? 'fetched' : 'baseline');
                    }
                    if (!result.cursor) break;
                    this.#cursor = result.cursor;
                }
            } finally {
                this.#reading = null;
                for (const event of this.#queued.splice(0))
                    this.#deliver(event, 'live');
            }
        })();
        return this.#reading;
    }

    #deliver(event, source) {
        if (this.#stopped) return;
        const notification = toNotification(event);
        if (!notification) return;
        const { uid } = notification;
        if (source === 'baseline') {
            this.#baseline.add(uid);
            return;
        }
        if (
            this.#seen.has(uid) ||
            (source === 'fetched' && this.#baseline.has(uid))
        )
            return;
        this.#seen.add(uid);
        if (this.#since !== undefined && notification.createdAt <= this.#since)
            return;
        try {
            const result = this.#handler(notification);
            if (result instanceof Promise) result.catch(report);
        } catch (error) {
            report(error);
        }
    }

    #fail(error) {
        if (this.#onError) {
            this.#onError(error);
            return;
        }
        console.error('[puter.notifications] listener stopped', error);
    }
}
