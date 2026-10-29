import { RealtimeEvents } from './realtimeEvents.js';

/** @typedef {import('./types.js').RealtimeServerEvent} RealtimeServerEvent */

const REALTIME_PATH = '/puterai/openai/v1/realtime';
const encoder = new TextEncoder();

/**
 * One live realtime session. Events in both directions are OpenAI Realtime API
 * events, unchanged.
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
                if (
                    data.length > 65536 ||
                    encoder.encode(data).byteLength > 65536
                ) {
                    // Browsers only accept 1000 and 3000-4999 here.
                    socket.close(4009, 'message too large');
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
 * @returns {WebSocket}
 * @internal
 */
export function createRealtimeSocket(puter, model) {
    const url = new URL(REALTIME_PATH, puter.APIOrigin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    if (model) url.searchParams.set('model', model);
    return new WebSocket(url.toString(), [
        'realtime',
        `openai-insecure-api-key.${puter.authToken}`,
    ]);
}
