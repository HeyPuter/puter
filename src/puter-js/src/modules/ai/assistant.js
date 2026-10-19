/** @typedef {import('./types.js').RealtimeConnectOptions} RealtimeConnectOptions */
/** @typedef {import('./types.js').RealtimeServerEvent} RealtimeServerEvent */

const REALTIME_PATH = '/puterai/openai/v1/realtime';

/**
 * One live realtime session. Events in both directions are OpenAI Realtime
 * API events, unchanged.
 */
export class RealtimeSession {
    /** @type {WebSocket} */
    socket;
    /** @type {Map<string, Set<(event: RealtimeServerEvent) => void>>} */
    #listeners = new Map();

    /** @param {WebSocket} socket */
    constructor (socket) {
        this.socket = socket;
        socket.addEventListener('message', (msg) => {
            /** @type {RealtimeServerEvent} */
            let event;
            try {
                event = JSON.parse(typeof msg.data === 'string' ? msg.data : String(msg.data));
            } catch {
                return;
            }
            this.#emit(event.type, event);
            this.#emit('*', event);
        });
        socket.addEventListener('close', (e) => {
            const event = { type: 'close', code: e.code, reason: e.reason };
            this.#emit('close', event);
            this.#emit('*', event);
        });
    }

    /**
     * Listen for a server event by its `type`; `'*'` receives every event and
     * `'close'` fires once when the connection ends.
     *
     * @param {string} type
     * @param {(event: RealtimeServerEvent) => void} handler
     * @returns {() => void} Removes the listener.
     */
    on (type, handler) {
        let set = this.#listeners.get(type);
        if ( ! set ) this.#listeners.set(type, set = new Set());
        set.add(handler);
        return () => this.off(type, handler);
    }

    /**
     * @param {string} type
     * @param {(event: RealtimeServerEvent) => void} handler
     * @returns {void}
     */
    off (type, handler) {
        this.#listeners.get(type)?.delete(handler);
    }

    /**
     * Send a client event, e.g. `{ type: 'response.create' }`.
     *
     * @param {{ type: string } & Record<string, unknown>} event
     * @returns {void}
     */
    send (event) {
        if ( this.socket.readyState !== 1 ) {
            throw { message: 'Realtime session is not open', code: 'session_closed' };
        }
        this.socket.send(JSON.stringify(event));
    }

    /** @returns {void} */
    close () {
        this.socket.close(1000);
    }

    /**
     * @param {string} type
     * @param {RealtimeServerEvent} event
     */
    #emit (type, event) {
        for ( const handler of this.#listeners.get(type) ?? [] ) {
            try {
                handler(event);
            } catch (e) {
                console.error('[puter.ai.assistant] listener error', e);
            }
        }
    }
}

/**
 * Open a realtime session against OpenAI's Realtime API through Puter.
 * Resolves once the socket is open; the first event to arrive is
 * `session.created`.
 *
 * @this {import('./index.js').AIModule}
 * @param {RealtimeConnectOptions} [options]
 * @returns {Promise<RealtimeSession>}
 */
export async function connect (options = {}) {
    const { puter } = this;
    if ( ! puter.authToken && puter.env === 'web' ) {
        try {
            await puter.ui.authenticateWithPuter();
        } catch {
            throw { message: 'Authentication canceled', code: 'auth_canceled' };
        }
    }
    if ( ! puter.authToken ) {
        throw { message: 'Authentication required', code: 'auth_required' };
    }

    const url = new URL(REALTIME_PATH, puter.APIOrigin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    if ( options.model ) url.searchParams.set('model', options.model);

    const socket = new WebSocket(url.toString(), [
        'realtime',
        `openai-insecure-api-key.${puter.authToken}`,
    ]);
    const session = new RealtimeSession(socket);

    await new Promise((resolve, reject) => {
        const onOpen = () => {
            socket.removeEventListener('close', onClose);
            resolve(undefined);
        };
        const onClose = (/** @type {CloseEvent} */ e) => {
            socket.removeEventListener('open', onOpen);
            reject({ message: e.reason || 'Realtime connection failed', code: 'connection_failed' });
        };
        socket.addEventListener('open', onOpen, { once: true });
        socket.addEventListener('close', onClose, { once: true });
    });

    return session;
}
