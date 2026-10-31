/**
 * Asked by the server with `{ uid }` on the page's sockets: answered once this
 * page has received that notification live, or with `{ received: false }` when
 * it doesn't in time.
 */
export const RECEIPT_EVENT = 'notif.receipt';

const REMEMBERED = 500;
const MAX_WAITING = 100;
// Longer than the server waits. A late answer is ignored there, but it still
// frees what the server's nodes keep for the ask.
const WAIT_MS = 10_000;

/**
 * @typedef {Object} Receipt
 * @property {true} received
 * @property {'visible' | 'hidden' | 'unknown'} visibilityState
 * @property {boolean} focused The page's window has focus.
 * @property {boolean} showsOwn The page shows a browser notification itself
 *   while hidden or unfocused.
 */

const MISSED = Object.freeze({ received: false });

/** @typedef {{ ack: Function; timer: ReturnType<typeof setTimeout> | null }} WaitingAsk */

/** Notifications this page received live, for the server's receipt asks. */
export class ReceiptLog {
    /** @type {Set<string>} */
    #received = new Set();
    /** @type {Map<string, WaitingAsk[]>} */
    #waiting = new Map();
    #waitingCount = 0;
    /** @type {() => boolean} */
    #showsOwn;

    /** @param {() => boolean} [showsOwn] */
    constructor(showsOwn = () => false) {
        this.#showsOwn = showsOwn;
    }

    /** @param {string} uid */
    note(uid) {
        this.#received.add(uid);
        if (this.#received.size > REMEMBERED) {
            this.#received.delete(this.#received.values().next().value);
        }
        const asks = this.#waiting.get(uid);
        if (!asks) return;
        this.#waiting.delete(uid);
        this.#waitingCount -= asks.length;
        const answer = this.#receipt();
        for (const ask of asks) {
            if (ask.timer) clearTimeout(ask.timer);
            ask.ack(answer);
        }
    }

    /**
     * Answers every ask: now when the page has the notification, when it
     * arrives, or `{ received: false }` once the wait runs out.
     *
     * @param {unknown} data
     * @param {unknown} ack
     */
    answer(data, ack) {
        if (typeof ack !== 'function') return;
        const uid = /** @type {{ uid?: unknown } | null} */ (data)?.uid;
        if (typeof uid !== 'string') {
            ack(MISSED);
            return;
        }
        if (this.#received.has(uid)) {
            ack(this.#receipt());
            return;
        }
        if (this.#waitingCount >= MAX_WAITING) {
            ack(MISSED);
            return;
        }
        /** @type {WaitingAsk} */
        const ask = { ack, timer: null };
        ask.timer = setTimeout(() => this.#expire(uid, ask), WAIT_MS);
        ask.timer?.unref?.();
        const asks = this.#waiting.get(uid) ?? [];
        asks.push(ask);
        this.#waiting.set(uid, asks);
        this.#waitingCount++;
    }

    /**
     * @param {string} uid
     * @param {WaitingAsk} ask
     */
    #expire(uid, ask) {
        const asks = this.#waiting.get(uid);
        const index = asks ? asks.indexOf(ask) : -1;
        if (!asks || index === -1) return;
        asks.splice(index, 1);
        if (asks.length === 0) this.#waiting.delete(uid);
        this.#waitingCount--;
        ask.ack(MISSED);
    }

    /** @returns {Receipt} */
    #receipt() {
        const doc = globalThis.document;
        const state = doc?.visibilityState;
        return {
            received: true,
            visibilityState:
                state === 'visible' || state === 'hidden' ? state : 'unknown',
            focused: doc?.hasFocus?.() === true,
            showsOwn: this.#showsOwn() === true,
        };
    }
}
