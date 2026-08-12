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
 *     | 'drain'
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
 * @property {() => Promise<string>} generateWispV1URL Mints a relay URL (server plus single-use
 * token) for speaking the Wisp v1 protocol directly.
 * @property {typeof import('./PSocket.js').PSocket} Socket Constructor for a raw TCP `Socket`.
 * @property {{ TLSSocket: typeof import('./PTLS.js').PTLSSocket }} tls Constructor for a
 * TLS-protected `TLSSocket`.
 * @property {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} fetch
 * Fetch an http/https resource without being bound by CORS restrictions.
 */

export {};
