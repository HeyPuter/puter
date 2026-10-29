/**
 * Asked by the server with `{ uid }` on the page's socket: acknowledged once a
 * notification feed on this page has received that notification.
 */
export const RECEIPT_EVENT = 'notif.receipt';

const REMEMBERED = 500;
const MAX_WAITING = 100;
// Longer than the server waits, which ignores a late answer.
const WAIT_MS = 10_000;

/** @returns {{ visibilityState: 'visible' | 'hidden' | 'unknown' }} */
const receipt = () => {
    const state = globalThis.document?.visibilityState;
    return {
        visibilityState:
            state === 'visible' || state === 'hidden' ? state : 'unknown',
    };
};

/** @typedef {{ ack: Function; timer: ReturnType<typeof setTimeout> }} WaitingAsk */

/** Notifications this page's feeds received, for the server's receipt asks. */
export class ReceiptLog {
    /** @type {Set<string>} */
    #received = new Set();
    /** @type {Map<string, WaitingAsk>} */
    #waiting = new Map();

    /** @param {string} uid */
    note(uid) {
        this.#received.add(uid);
        if (this.#received.size > REMEMBERED) {
            this.#received.delete(this.#received.values().next().value);
        }
        const waiting = this.#waiting.get(uid);
        if (!waiting) return;
        this.#waiting.delete(uid);
        clearTimeout(waiting.timer);
        waiting.ack(receipt());
    }

    /**
     * Acknowledges now when a feed has the notification, or when it arrives;
     * never when no feed on this page gets it.
     *
     * @param {unknown} data
     * @param {unknown} ack
     */
    answer(data, ack) {
        if (typeof ack !== 'function') return;
        const uid = /** @type {{ uid?: unknown } | null} */ (data)?.uid;
        if (typeof uid !== 'string') return;
        if (this.#received.has(uid)) {
            ack(receipt());
            return;
        }
        if (this.#waiting.has(uid) || this.#waiting.size >= MAX_WAITING) return;
        const timer = setTimeout(() => this.#waiting.delete(uid), WAIT_MS);
        timer?.unref?.();
        this.#waiting.set(uid, { ack, timer });
    }
}
