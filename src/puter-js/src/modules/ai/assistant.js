import { RealtimeEvents } from './realtimeEvents.js';

/** @typedef {import('./types.js').RealtimeConnectOptions} RealtimeConnectOptions */
/** @typedef {import('./types.js').RealtimeServerEvent} RealtimeServerEvent */

const REALTIME_PATH = '/puterai/openai/v1/realtime';
const encoder = new TextEncoder();

/**
 * One live realtime session. Events in both directions are OpenAI Realtime API
 * events, unchanged.
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
                    socket.close(1009);
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

    /**
     * Send a client event, e.g. `{ type: 'response.create' }`.
     *
     * @param {{ type: string } & Record<string, unknown>} event
     * @returns {void}
     */
    send(event) {
        if (this.socket.readyState !== 1) {
            throw {
                message: 'Realtime session is not open',
                code: 'session_closed',
            };
        }
        this.socket.send(JSON.stringify(event));
    }

    /** @returns {void} */
    close() {
        this.socket.close(1000);
    }
}

/**
 * Open a realtime session against OpenAI's Realtime API through Puter. Resolves
 * once the socket is open; the first event to arrive is `session.created`.
 *
 * @this {import('./index.js').AIModule}
 * @param {RealtimeConnectOptions} [options]
 * @returns {Promise<RealtimeSession>}
 */
export async function connect(options = {}) {
    const { puter } = this;
    if (!puter.authToken && puter.env === 'web') {
        try {
            await puter.ui.authenticateWithPuter();
        } catch {
            throw { message: 'Authentication canceled', code: 'auth_canceled' };
        }
    }
    if (!puter.authToken) {
        throw { message: 'Authentication required', code: 'auth_required' };
    }

    const socket = createRealtimeSocket(puter, options.model);
    const session = new RealtimeSession(socket);

    await new Promise((resolve, reject) => {
        const onOpen = () => {
            socket.removeEventListener('close', onClose);
            resolve(undefined);
        };
        const onClose = (/** @type {CloseEvent} */ e) => {
            socket.removeEventListener('open', onOpen);
            reject({
                message: e.reason || 'Realtime connection failed',
                code: 'connection_failed',
            });
        };
        socket.addEventListener('open', onOpen, { once: true });
        socket.addEventListener('close', onClose, { once: true });
    });

    return session;
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
