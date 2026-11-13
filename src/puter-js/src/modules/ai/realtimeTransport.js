import { RealtimeEvents } from './realtimeEvents.js';

/** @typedef {import('./types.js').RealtimeServerEvent} RealtimeServerEvent */

const REALTIME_PATH = '/puterai/openai/v1/realtime';
const encoder = new TextEncoder();
// The relay's cap on provider messages, which can carry whole items. What the
// SDK sends is capped separately, and much lower.
const MAX_SERVER_MESSAGE_BYTES = 4 * 1024 * 1024;
/**
 * Close code for a server event over the limit; browsers only accept 1000 and
 * 3000-4999 from the client.
 *
 * @internal
 */
export const CLOSE_MESSAGE_TOO_LARGE = 4009;

/**
 * Whether `data` encodes to more than `limit` UTF-8 bytes. A UTF-16 code unit
 * encodes to at most three bytes, so only a long string is encoded to check.
 *
 * @param {string} data
 * @param {number} limit
 * @returns {boolean}
 */
const exceedsBytes = (data, limit) =>
    data.length > limit ||
    (data.length * 3 > limit && encoder.encode(data).byteLength > limit);

/**
 * One live realtime session. Events in both directions are OpenAI Realtime API
 * events, unchanged.
 *
 * @internal
 */
export class RealtimeSession extends RealtimeEvents {
    /** @type {WebSocket} */
    socket;
    /** @param {WebSocket} socket */
    constructor(socket) {
        super();
        this.socket = socket;
        socket.addEventListener('message', (msg) => {
            /** @type {RealtimeServerEvent} */
            let event;
            try {
                const data =
                    typeof msg.data === 'string' ? msg.data : String(msg.data);
                if (exceedsBytes(data, MAX_SERVER_MESSAGE_BYTES)) {
                    socket.close(CLOSE_MESSAGE_TOO_LARGE, 'message too large');
                    return;
                }
                event = JSON.parse(data);
                if (
                    !event ||
                    typeof event.type !== 'string' ||
                    !event.type.length ||
                    event.type.length > 128 ||
                    Array.isArray(event)
                )
                    return;
            } catch {
                return;
            }
            this.emitRealtime(event);
        });
        socket.addEventListener('close', (e) => {
            const event = { type: 'close', code: e.code, reason: e.reason };
            this.emitRealtime(event);
        });
    }

    /** @returns {void} */
    close() {
        this.socket.close(1000);
    }
}

/**
 * @param {import('../../index.js').Puter} puter
 * @param {string} [model]
 * @param {'handover'} [purpose]
 * @returns {WebSocket}
 * @internal
 */
export function createRealtimeSocket(puter, model, purpose) {
    const url = new URL(REALTIME_PATH, puter.APIOrigin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    if (model) url.searchParams.set('model', model);
    if (purpose) url.searchParams.set('purpose', purpose);
    return new WebSocket(url.toString(), [
        'realtime',
        `openai-insecure-api-key.${puter.authToken}`,
    ]);
}
