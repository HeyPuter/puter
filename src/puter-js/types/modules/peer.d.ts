export interface PuterPeerOptions {
    iceServers?: RTCIceServer[];
}

export interface PuterPeerUser extends Record<string, unknown> {}

export type PuterPeerMessage = string | Blob | ArrayBuffer | ArrayBufferView;
export type PuterPeerDescription = RTCSessionDescription | RTCSessionDescriptionInit;
export type PuterPeerIceCandidate = RTCIceCandidate | RTCIceCandidateInit;

export class PuterPeerServerConnectionEvent extends Event {
    readonly conn: PuterPeerConnection;
    readonly user: PuterPeerUser;
}

export class PuterPeerConnectionMessageEvent extends Event {
    readonly data: unknown;
}

export class PuterPeerConnectionOpenEvent extends Event {}

export class PuterPeerConnectionCloseEvent extends Event {
    readonly reason?: unknown;
}

export class PuterPeerConnectionErrorEvent extends Event {
    readonly error: unknown;
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

export class PuterPeerServer extends EventTarget {
    inviteCode?: string;

    start (): Promise<string>;
    message (data: unknown): Promise<void>;

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

export class PuterPeerConnection extends EventTarget {
    peerconnection: RTCPeerConnection;
    connected: boolean;
    closed: boolean;

    connect (invitecode: string): Promise<void>;
    close (reason?: unknown): void;
    createOffer (): Promise<RTCSessionDescriptionInit>;
    createAnswer (): Promise<RTCSessionDescriptionInit>;
    setRemoteDescription (description: PuterPeerDescription): void;
    addIceCandidate (candidate: PuterPeerIceCandidate): void;
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

export default class Peer {
    authToken?: string | null;
    APIOrigin: string;
    appID?: string;

    setAuthToken (authToken: string): void;
    setAPIOrigin (APIOrigin: string): void;
    ensureTurnRelays (): Promise<void>;
    serve (options?: PuterPeerOptions): Promise<PuterPeerServer>;
    connect (invitecode: string, options?: PuterPeerOptions): Promise<PuterPeerConnection>;
}
