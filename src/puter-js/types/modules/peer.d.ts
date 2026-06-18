/** Options for `puter.peer.serve()` and `puter.peer.connect()`. */
export interface PuterPeerOptions {
    /** Custom ICE servers (STUN/TURN) to use instead of the Puter-managed relays. */
    iceServers?: RTCIceServer[];
}

/** Metadata about a peer user. */
export interface PuterPeerUser {
    username: string;
    uuid: string;
}

export type PuterPeerMessage = string | Blob | ArrayBuffer | ArrayBufferView;
export type PuterPeerDescription = RTCSessionDescription | RTCSessionDescriptionInit;
export type PuterPeerIceCandidate = RTCIceCandidate | RTCIceCandidateInit;

/** Dispatched by `PuterPeerServer` for the `'connection'` event when a client connects. */
export class PuterPeerServerConnectionEvent extends Event {
    /** The connection to the client. */
    readonly conn: PuterPeerConnection;
    /** Metadata about the connecting user (if available). */
    readonly user: PuterPeerUser;
}

/** Dispatched by `PuterPeerConnection` for the `'message'` event when a message is received. */
export class PuterPeerConnectionMessageEvent extends Event {
    /** The received message payload. */
    readonly data: ArrayBuffer | string;
}

/** Dispatched by `PuterPeerConnection` for the `'open'` event when the data channel is ready. */
export class PuterPeerConnectionOpenEvent extends Event {}

/** Dispatched by `PuterPeerConnection` for the `'close'` event when the connection closes. */
export class PuterPeerConnectionCloseEvent extends Event {
    /** The reason the connection was closed, if one was provided. */
    readonly reason?: string;
}

/** Dispatched by `PuterPeerConnection` for the `'error'` event when a connection error occurs. */
export class PuterPeerConnectionErrorEvent extends Event {
    readonly error: string;
}

export interface PuterPeerServerEventMap {
    connection: PuterPeerServerConnectionEvent;
}

export interface PuterPeerConnectionEventMap {
    open: PuterPeerConnectionOpenEvent;
    message: PuterPeerConnectionMessageEvent;
    close: PuterPeerConnectionCloseEvent;
    error: PuterPeerConnectionErrorEvent;
}

/**
 * A peer server created by `puter.peer.serve()`. Emits a `'connection'` event
 * when a client connects.
 */
export class PuterPeerServer extends EventTarget {
    /** The invite code to share with other clients so they can connect. */
    inviteCode?: string;
    /** Map of all connected clients, keyed by id. */
    connections: Map<string, PuterPeerConnection>;

    start (): Promise<string>;
    message (data: ArrayBuffer | string): Promise<void>;

    addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
    addEventListener<K extends keyof PuterPeerServerEventMap>(
        type: K,
        listener: (this: PuterPeerServer, ev: PuterPeerServerEventMap[K]) => unknown,
        options?: boolean | AddEventListenerOptions,
    ): void;
    removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void;
    removeEventListener<K extends keyof PuterPeerServerEventMap>(
        type: K,
        listener: (this: PuterPeerServer, ev: PuterPeerServerEventMap[K]) => unknown,
        options?: boolean | EventListenerOptions,
    ): void;
}

/**
 * A WebRTC data-channel connection to a peer. Emits `'open'`, `'message'`,
 * `'close'`, and `'error'` events.
 */
export class PuterPeerConnection extends EventTarget {
    peerconnection: RTCPeerConnection;
    /** Information about the user who created the server. */
    owner?: PuterPeerUser;
    connected: boolean;
    closed: boolean;

    connect (invitecode: string): Promise<void>;
    /** Close the connection, optionally providing a reason. */
    close (reason?: string): void;
    createOffer (): Promise<RTCSessionDescriptionInit>;
    createAnswer (): Promise<RTCSessionDescriptionInit>;
    setRemoteDescription (description: PuterPeerDescription): void;
    addIceCandidate (candidate: PuterPeerIceCandidate): void;
    /** Send a message to the peer. Supports `string`, `Blob`, `ArrayBuffer`, or `ArrayBufferView`. */
    send (message: PuterPeerMessage): void;

    addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
    addEventListener<K extends keyof PuterPeerConnectionEventMap>(
        type: K,
        listener: (this: PuterPeerConnection, ev: PuterPeerConnectionEventMap[K]) => unknown,
        options?: boolean | AddEventListenerOptions,
    ): void;
    removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void;
    removeEventListener<K extends keyof PuterPeerConnectionEventMap>(
        type: K,
        listener: (this: PuterPeerConnection, ev: PuterPeerConnectionEventMap[K]) => unknown,
        options?: boolean | EventListenerOptions,
    ): void;
}

/**
 * The `puter.peer` API. Provides WebRTC data channels with built-in signaling
 * and TURN relays for connecting clients directly without your own signaling
 * server. Peer connections require authentication.
 */
export default class Peer {
    authToken?: string | null;
    APIOrigin: string;
    appID?: string;

    setAuthToken (authToken: string): void;
    setAPIOrigin (APIOrigin: string): void;
    /**
     * Fetches TURN relay credentials ahead of time so peer connections start
     * faster. Optional, since `serve()` and `connect()` call it automatically
     * when needed. Resolves once relay details are cached; if relays cannot be
     * loaded, Puter.js falls back to default ICE servers when connecting.
     */
    ensureTurnRelays (): Promise<void>;
    /**
     * Create a peer server that generates an invite code other clients can use
     * to connect.
     * @returns A `Promise` that resolves to a `PuterPeerServer`.
     */
    serve (options?: PuterPeerOptions): Promise<PuterPeerServer>;
    /**
     * Connect to a peer server using an invite code created by `serve()`.
     * @returns A `Promise` that resolves to a `PuterPeerConnection`.
     */
    connect (invitecode: string, options?: PuterPeerOptions): Promise<PuterPeerConnection>;
}
