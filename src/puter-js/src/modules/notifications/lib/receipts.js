/**
 * Asked by the server with `{ uid }` on the page's sockets: answered once this
 * page has received that notification live, or with `{ received: false }` when
 * it doesn't in time.
 */
export const RECEIPT_EVENT = 'notif.receipt';

/**
 * Sent with `{ uid }` when the page received that notification live while
 * visible and focused, so no push goes out for it from any region.
 */
export const HANDLED_EVENT = 'notif.handled';

const REMEMBERED = 500;
const MAX_WAITING = 100;
// Longer than the server waits. A late answer is ignored there, but it still
// frees what the server's nodes keep for the ask.
const WAIT_MS = 10_000;

/**
 * @typedef {Object} Receipt
 * @property {true} received
 * @property {'visible' | 'hidden' | 'unknown'} visibilityState When the page
 *   received it.
 * @property {boolean} focused The page's window had focus when it received it.
 */

const MISSED = Object.freeze({ received: false });

/** @typedef {{ ack: Function; timer: ReturnType<typeof setTimeout> | null }} WaitingAsk */

/**
 * The page counts as handling a notification it received while visible and
 * focused; otherwise the notification goes out as a push.
 *
 * @param {Receipt} receipt
 */
export const handledHere = (receipt) =>
    receipt.visibilityState === 'visible' && receipt.focused;

/** @returns {Receipt} */
const receiptNow = () => {
    const doc = globalThis.document;
    const state = doc?.visibilityState;
    return {
        received: true,
        visibilityState:
            state === 'visible' || state === 'hidden' ? state : 'unknown',
        focused: doc?.hasFocus?.() === true,
    };
};

/** Notifications this page received live, for the server's receipt asks. */
export class ReceiptLog {
    /** @type {Map<string, Receipt>} */
    #received = new Map();
    /** @type {Map<string, WaitingAsk[]>} */
    #waiting = new Map();
    #waitingCount = 0;

    /** @param {string} uid */
    has(uid) {
        return this.#received.has(uid);
    }

    /**
     * Records `uid` with the page's state now, which every answer about it
     * gives.
     *
     * @param {string} uid
     * @returns {Receipt}
     */
    note(uid) {
        const receipt = this.#received.get(uid) ?? receiptNow();
        this.#received.set(uid, receipt);
        if (this.#received.size > REMEMBERED) {
            this.#received.delete(this.#received.keys().next().value);
        }
        const asks = this.#waiting.get(uid);
        if (!asks) return receipt;
        this.#waiting.delete(uid);
        this.#waitingCount -= asks.length;
        for (const ask of asks) {
            if (ask.timer) clearTimeout(ask.timer);
            ask.ack(receipt);
        }
        return receipt;
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
        const receipt = this.#received.get(uid);
        if (receipt) {
            ack(receipt);
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
}
