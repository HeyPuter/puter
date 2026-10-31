import { PuterJSError } from '../../../lib/PuterJSError.js';
import { toNotification } from './shapes.js';

/** From an app, its own slice of the user's mailbox. */
export const SUBJECT = 'notif:app-user';

const PAGE_SIZE = 200;
// Retention bounds a read; this only ends a cursor that never runs out.
const MAX_PAGES = 100_000;
// A read restarts at the last cursor: only its last page and later can repeat.
const REMEMBERED = 5000;

/** Notes `uid` at `version`, dropping the oldest entry past `keep`. */
const remember = (versions, uid, version, keep) => {
    versions.delete(uid);
    versions.set(uid, version);
    if (versions.size > keep) versions.delete(versions.keys().next().value);
};

/** Whether `uid` was already noted at `version` or later. */
const known = (versions, uid, version) =>
    versions.has(uid) && versions.get(uid) >= version;

/**
 * A replacement keeps its uid; its time, the same on live and fetched copies,
 * tells it from a copy already handed over.
 */
const versionOf = (notification) =>
    notification.replaced ? notification.createdAt : 0;

const toSeconds = (ms) => Math.floor(ms / 1000);

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

/**
 * A live subscription plus reads of what it missed, each uid handed over once
 * per version.
 */
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
    /** @type {(uid: string) => void} */
    #onReceived;

    /** @type {Map<string, number>} uid → version handed over */
    #seen = new Map();
    /**
     * What was already there when a listener started without catch-up.
     *
     * @type {Map<string, number>}
     */
    #baseline = new Map();
    /** @type {string | undefined} */
    #cursor;
    /** @type {Promise<void> | null} */
    #reading = null;
    #gapPending = false;
    /** @type {unknown[]} */
    #queued = [];
    /** @type {{ off: () => Promise<void> } | null} */
    #subscription = null;
    #stopped = false;
    #liveSinceRead = 0;
    /** @type {Error | null} */
    #startError = null;
    #starting = false;
    /** @type {(() => unknown) | null} */
    #stopWatchingAuth = null;

    /** @param {(uid: string) => void} [onReceived] Told of each live arrival. */
    constructor(puter, handler, options, onReceived = () => {}) {
        this.#puter = puter;
        this.#handler = handler;
        this.#onReceived = onReceived;
        this.#onError = options.onError;
        this.#catchUp = options.catchUp !== false;
        this.#since =
            typeof options.since === 'number' ? options.since : undefined;
    }

    /** @returns {Promise<void>} */
    async start() {
        this.#starting = true;
        try {
            await this.#open();
        } finally {
            this.#starting = false;
        }
    }

    // A stop while starting rejects `start()` instead of calling `onError`.
    async #open() {
        try {
            this.#subscription = await this.#puter.events.onLocal(
                SUBJECT,
                ({ event }) => this.#receive(event),
                { onError: (error) => this.#halt(error) },
            );
        } catch (error) {
            throw unavailable(error);
        }
        if (this.#startError) throw this.#startError;

        const token = this.#puter.authToken;
        this.#stopWatchingAuth =
            this.#puter.onAuthStateChanged?.(() => {
                if (this.#puter.authToken === token) return;
                this.#halt(
                    new PuterJSError(
                        'The signed-in account or app changed',
                        'auth_changed',
                    ),
                );
            }) ?? null;

        try {
            await this.#read(this.#catchUp ? 'fetched' : 'baseline');
        } catch (error) {
            await this.off();
            throw this.#startError ?? unavailable(error);
        }
        if (this.#startError) throw this.#startError;
    }

    /** @returns {Promise<void>} */
    async off() {
        this.#stopped = true;
        this.#queued = [];
        this.#gapPending = false;
        this.#stopWatchingAuth?.();
        this.#stopWatchingAuth = null;
        const subscription = this.#subscription;
        this.#subscription = null;
        await subscription?.off();
    }

    #receive(event) {
        if (this.#stopped) return;
        if (event?.op === 'gap') {
            this.#readAfterGap();
            return;
        }
        // Before any handler runs, so a slow or failing one still counts.
        const uid = toNotification(event)?.uid;
        if (uid) this.#onReceived(uid);
        if (this.#reading) {
            this.#queued.push(event);
            return;
        }
        this.#deliver(event, 'live');
    }

    #readAfterGap() {
        if (this.#reading) {
            this.#gapPending = true;
            return;
        }
        this.#read('fetched').catch((error) =>
            this.#halt(PuterJSError.from(error)),
        );
    }

    // Live events wait in `#queued` meanwhile, so delivery stays oldest first.
    #read(source) {
        const run = async () => {
            let ok = false;
            try {
                let ended = false;
                for (let page = 0; page < MAX_PAGES && !this.#stopped; page++) {
                    const result = await this.#puter.events.fetch({
                        subject: SUBJECT,
                        limit: PAGE_SIZE,
                        ...(this.#cursor ? { cursor: this.#cursor } : {}),
                    });
                    for (const event of result.items) {
                        this.#deliver(event, source);
                    }
                    if (!result.cursor) {
                        ended = true;
                        break;
                    }
                    this.#cursor = result.cursor;
                }
                if (!ended && !this.#stopped) {
                    this.#fail(
                        new PuterJSError(
                            'Stopped reading missed notifications after too many pages',
                            'catch_up_truncated',
                        ),
                    );
                }
                this.#liveSinceRead = 0;
                ok = true;
            } finally {
                this.#reading = null;
                if (ok && this.#gapPending && !this.#stopped) {
                    this.#gapPending = false;
                    this.#readAfterGap();
                } else {
                    for (const event of this.#queued.splice(0))
                        this.#deliver(event, 'live');
                }
            }
        };
        this.#reading = run();
        return this.#reading;
    }

    #deliver(event, source) {
        if (this.#stopped) return;
        const notification = toNotification(event);
        if (!notification) return;
        const { uid } = notification;
        const version = versionOf(notification);
        if (source === 'baseline') {
            remember(this.#baseline, uid, version, REMEMBERED);
            return;
        }
        if (known(this.#seen, uid, version)) return;
        if (source === 'fetched') {
            if (known(this.#baseline, uid, version)) return;
            if (
                this.#since !== undefined &&
                toSeconds(notification.createdAt) < toSeconds(this.#since)
            )
                return;
        }
        if (source === 'live') this.#liveSinceRead++;
        remember(
            this.#seen,
            uid,
            version,
            Math.max(REMEMBERED, PAGE_SIZE + this.#liveSinceRead),
        );
        try {
            const result = this.#handler(notification);
            if (result instanceof Promise) result.catch(report);
        } catch (error) {
            report(error);
        }
    }

    // Stops the listener first, so nothing is delivered after `onError`.
    #halt(error) {
        if (this.#stopped) return;
        void this.off();
        if (this.#starting) {
            this.#startError = error;
            return;
        }
        this.#fail(error);
    }

    #fail(error) {
        if (this.#onError) {
            this.#onError(error);
            return;
        }
        console.error('[puter.notifications] listener error', error);
    }
}
