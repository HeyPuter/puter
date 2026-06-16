/** Names of events emitted by a socket. Plain `PSocket` uses `'open'`, `'data'`, `'close'`, `'error'`; `PTLSSocket` uses the `'tls'`-prefixed variants. */
export type SocketEvent =
    | 'open'
    | 'data'
    | 'error'
    | 'close'
    | 'drain'
    | 'tlsdata'
    | 'tlsopen'
    | 'tlsclose';

/**
 * A raw TCP socket usable directly in the browser.
 * Construct via `puter.net.Socket(hostname, port)`.
 */
export class PSocket {
    /**
     * @param host The hostname of the server to connect to (an IP address or domain name).
     * @param port The port number to connect to on the server.
     */
    constructor (host: string, port: number);
    /** Write data to the socket. */
    write (data: ArrayBuffer | ArrayBufferView | string, callback?: () => void): void;
    /** Voluntarily close the TCP socket. */
    close (): void;
    /** `'open'` fires when the socket is initialized and ready to send data. */
    on (event: 'open', handler: () => void): void;
    /** `'data'` fires when the remote server sends data over the socket; `buffer` is the received data. */
    on (event: 'data', handler: (buffer: Uint8Array) => void): void;
    /** `'error'` fires when the socket encounters an error (a `'close'` event follows shortly after). The human-readable reason is on `error.message`. */
    on (event: 'error', handler: (error: Error) => void): void;
    /** `'close'` fires when the socket is closed; `hadError` is `true` if it closed due to an error. */
    on (event: 'close', handler: (hadError: boolean) => void): void;
    /** Register a handler for a socket event by name. */
    addListener (event: SocketEvent, handler: (...args: unknown[]) => void): void;
}

/**
 * A TLS-protected TCP socket usable directly in the browser. The interface is
 * the same as `PSocket` but the connection is encrypted. Its events are
 * `'tls'`-prefixed. Construct via `puter.net.tls.TLSSocket(hostname, port)`.
 */
export class PTLSSocket extends PSocket {
    /**
     * @param host The hostname of the server to connect to (an IP address or domain name).
     * @param port The port number to connect to on the server.
     */
    constructor (host: string, port: number);
    /** `'tlsopen'` fires when the socket is initialized and ready to send data. */
    on (event: 'tlsopen', handler: () => void): void;
    /** `'tlsdata'` fires when the remote server sends data over the socket; `buffer` is the received data. */
    on (event: 'tlsdata', handler: (buffer: Uint8Array) => void): void;
    /** `'tlsclose'` fires when the socket is closed; `hadError` is `true` if it closed due to an error. */
    on (event: 'tlsclose', handler: (hadError: boolean) => void): void;
}

/**
 * The `puter.net` networking API. Establishes network connections directly from
 * the frontend without a server or proxy, and bypasses CORS restrictions.
 */
export interface Networking {
    generateWispV1URL(): Promise<string>;
    /** Constructor for a raw TCP `Socket`. */
    Socket: typeof PSocket;
    tls: {
        /** Constructor for a TLS-protected `TLSSocket`. */
        TLSSocket: typeof PTLSSocket;
    };
    /**
     * Fetch an http/https resource without being bound by CORS restrictions.
     * @param init A standard `RequestInit` object.
     * @returns A `Promise` that resolves to a `Response`.
     */
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
