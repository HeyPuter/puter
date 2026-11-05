// Shapes shared across the `puter.net` sockets. JSDoc-only; no runtime exports.

/**
 * Names of events emitted by a socket. Plain `PSocket` uses `'open'`,
 * `'data'`, `'close'`, `'error'`; `PTLSSocket` uses the `'tls'`-prefixed
 * variants.
 *
 * @typedef {'open'
 *     | 'data'
 *     | 'error'
 *     | 'close'
 *     | 'tlsdata'
 *     | 'tlsopen'
 *     | 'tlsclose'} SocketEvent
 */

/**
 * The `puter.net` networking API. Establishes network connections directly
 * from the frontend without a server or proxy, and bypasses CORS
 * restrictions.
 *
 * @typedef {Object} Networking
 * @property {() => Promise<string>} generateWispV1URL Mints a relay URL (server plus a token valid
 * for 24 hours) for speaking the Wisp v1 protocol directly.
 * @property {typeof import('./PSocket.js').PSocket} Socket Constructor for a raw TCP `Socket`.
 * @property {{ TLSSocket: typeof import('./PSocket.js').PTLSSocket }} tls Constructor for a
 * TLS-protected `TLSSocket`.
 * @property {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} fetch
 * Fetch an http/https resource without being bound by CORS restrictions.
 */

/**
 * The relay websockets behind one epoxy client.
 *
 * @typedef {{
 *     sockets: Set<WebSocket>;
 *     current: WebSocket | undefined;
 *     down: boolean;
 *     closed: boolean;
 * }} RelayTransport
 * @internal
 */

export {};
